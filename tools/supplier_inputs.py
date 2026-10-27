"""Validate the complete supplier publication before copying any public feed."""
import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlsplit

SUPPLIER_FILES = {'suppliers': 'profiles', 'offers': 'observations', 'changes': 'changes',
                  'fx': 'fx', 'health': 'health', 'manifest': 'manifest'}
PUBLIC_NAMES = {'suppliers': 'supplier_profiles', **{key: 'supplier_' + key for key in SUPPLIER_FILES if key != 'suppliers'}}


def https_url(value):
    try:
        url = urlsplit(value)
        return url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password and url.port in (None, 443)
    except (ValueError, TypeError):
        return False


def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError('Timezone required')
        return result
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError('Invalid supplier timestamp') from exc


def validate_supplier_inputs(data_dir):
    root = Path(data_dir)
    canonical = root / 'supply-chain/eu-suppliers'
    paths = {key: canonical / (key + '.v1.json') for key in SUPPLIER_FILES}
    if not any(path.exists() for path in paths.values()):
        paths = {key: root / (PUBLIC_NAMES[key] + '.json') for key in SUPPLIER_FILES}
    if not any(path.exists() for path in paths.values()):
        return False
    if not all(path.is_file() and not path.is_symlink() for path in paths.values()):
        raise ValueError('Supplier publication is incomplete')
    rows = {key: json.loads(path.read_bytes()) for key, path in paths.items()}
    for key, kind in SUPPLIER_FILES.items():
        if rows[key].get('schema') != 'forge.supplier-' + kind + '.v1':
            raise ValueError('Supplier schema mismatch: ' + key)
    manifest = rows['manifest']
    if set(manifest.get('files', {})) != {key + '.v1.json' for key in SUPPLIER_FILES if key != 'manifest'}:
        raise ValueError('Supplier manifest file set invalid')
    for key, path in paths.items():
        if key != 'manifest' and manifest['files'].get(key + '.v1.json') != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('Supplier publication hash mismatch: ' + key)
    suppliers = {row['id'] for row in rows['suppliers']['suppliers']}
    if len(suppliers) != len(rows['suppliers']['suppliers']):
        raise ValueError('Duplicate supplier profile')
    offers = set()
    for row in rows['offers']['offers']:
        if row['supplier_id'] not in suppliers or row['offer_id'] in offers:
            raise ValueError('Supplier reference or offer identity invalid')
        offers.add(row['offer_id'])
        if row.get('evidence_storage') != 'private_r2':
            raise ValueError('Public offers require stored source evidence')
        for key in ('evidence_sha256', 'observation_evidence_sha256'):
            if not re.fullmatch('[a-f0-9]{64}', str(row.get(key, ''))):
                raise ValueError('Supplier evidence hash missing or invalid')
        if timestamp(row.get('observed_at')) >= timestamp(row.get('expires_at')):
            raise ValueError('Invalid supplier freshness interval')
        if not https_url(row.get('source_url')) or not isinstance(row.get('identity'), dict) or not row['identity'].get('name'):
            raise ValueError('Supplier identity/source missing')
        price = row.get('price', {})
        if price.get('tax') not in ('included', 'excluded', 'unknown'):
            raise ValueError('Unknown supplier tax semantics')
        if price.get('amount') is not None:
            try:
                amount = Decimal(str(price['amount']))
                if not amount.is_finite() or amount < 0 or not re.fullmatch('[A-Z]{3}', str(price.get('currency', ''))):
                    raise ValueError('Invalid supplier amount/currency')
            except InvalidOperation as exc:
                raise ValueError('Invalid supplier amount') from exc
        for key in ('ships_from', 'shipping_destinations'):
            countries = row.get(key)
            if not isinstance(countries, list) or any(not re.fullmatch('[A-Z]{2}', str(country)) for country in countries):
                raise ValueError('Invalid supplier country list')
        if row.get('provenance') not in ('public_supplier_page', 'public_supplier_feed'):
            raise ValueError('Unrecognized observation provenance')
    return True
