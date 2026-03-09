"""
seed.py — Shared seeding logic for DroneClear parts database.

Reads golden parts from docs/golden_parts_db_seed/ (per-category JSON files)
and creates all categories defined in the schema.

Seed data includes:
  - 3,113 real FPV drone parts across 12 categories
  - 12 curated drone model build recipes (5", 6", 7", 10" builds)
  - 3 detailed build guides with expert assembly instructions

Used by:
  - management command: reset_to_golden
  - API view: ResetToGoldenView
  - post_migrate signal: auto-seed on fresh database
"""
import json
import os
from pathlib import Path

from django.conf import settings
from django.db import transaction

from components.models import (
    Category, Component, DroneModel,
    BuildGuide, BuildGuideStep,
)


# Fields stored directly on the Component model (not in schema_data)
CORE_KEYS = {
    'pid', 'category', 'name', 'manufacturer', 'description',
    'link', 'image_file', 'manual_link', 'approx_price',
}

SEED_DIR = os.path.join(settings.BASE_DIR, 'docs', 'golden_parts_db_seed')
SCHEMA_PATH = os.path.join(settings.BASE_DIR, 'drone_parts_schema_v3.json')

# Seed data file paths
SEED_DRONE_MODELS_PATH = os.path.join(SEED_DIR, 'drone_models.json')
SEED_BUILD_GUIDES_PATH = os.path.join(SEED_DIR, 'build_guides.json')


def _load_schema_categories():
    """Return list of category slugs from the schema file."""
    if not os.path.exists(SCHEMA_PATH):
        return []
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = json.load(f)
    return list(schema.get('components', {}).keys())


def _load_seed_parts():
    """Load all parts from the golden seed directory. Returns list of dicts.
    Skips drone_models.json and build_guides.json (handled separately)."""
    parts = []
    seed_path = Path(SEED_DIR)
    if not seed_path.is_dir():
        return parts
    skip_files = {'drone_models.json', 'build_guides.json'}
    for json_file in sorted(seed_path.glob('*.json')):
        if json_file.name in skip_files:
            continue
        with open(json_file, 'r', encoding='utf-8') as f:
            file_parts = json.load(f)
        if isinstance(file_parts, list):
            parts.extend(file_parts)
    return parts


def _load_drone_models():
    """Load golden drone models from the schema file."""
    if not os.path.exists(SCHEMA_PATH):
        return []
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = json.load(f)
    return schema.get('drone_models', [])


def _load_seed_drone_models():
    """Load curated drone models from the seed directory."""
    if not os.path.exists(SEED_DRONE_MODELS_PATH):
        return []
    with open(SEED_DRONE_MODELS_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def _load_seed_build_guides():
    """Load curated build guides from the seed directory."""
    if not os.path.exists(SEED_BUILD_GUIDES_PATH):
        return []
    with open(SEED_BUILD_GUIDES_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def _create_drone_model(model_data):
    """Create a single DroneModel from seed data dict. Returns the model or None."""
    pid = model_data.get('pid')
    if not pid:
        return None
    return DroneModel.objects.create(
        pid=pid,
        name=model_data.get('name', ''),
        description=model_data.get('description', ''),
        image_file=model_data.get('image_file', ''),
        pdf_file=model_data.get('pdf_file', ''),
        vehicle_type=model_data.get('vehicle_type', ''),
        build_class=model_data.get('build_class', ''),
        relations=model_data.get('relations', {}),
    )


@transaction.atomic
def seed_golden(wipe=True):
    """
    Seed the database with golden parts data.

    Args:
        wipe: If True, delete all existing components/models/categories first.

    Returns:
        dict with counts: deleted_components, deleted_models,
                          categories, components, drone_models,
                          build_guides
    """
    result = {
        'deleted_components': 0,
        'deleted_models': 0,
        'categories': 0,
        'components': 0,
        'drone_models': 0,
        'build_guides': 0,
    }

    if wipe:
        result['deleted_components'] = Component.objects.count()
        result['deleted_models'] = DroneModel.objects.count()
        # Delete build guides first (steps cascade via FK)
        BuildGuide.objects.all().delete()
        Component.objects.all().delete()
        DroneModel.objects.all().delete()
        Category.objects.all().delete()

    # 1. Create all categories from schema (ensures full category list in UI)
    category_slugs = _load_schema_categories()
    category_map = {}
    for slug in category_slugs:
        cat, _ = Category.objects.get_or_create(
            slug=slug,
            defaults={'name': slug.replace('_', ' ').title()},
        )
        category_map[slug] = cat

    # 2. Load seed parts and create components
    seed_parts = _load_seed_parts()
    components_created = 0
    for part in seed_parts:
        pid = part.get('pid')
        cat_slug = part.get('category')
        if not pid or not cat_slug:
            continue

        # Create category on-the-fly if seed file references one not in schema
        if cat_slug not in category_map:
            cat, _ = Category.objects.get_or_create(
                slug=cat_slug,
                defaults={'name': cat_slug.replace('_', ' ').title()},
            )
            category_map[cat_slug] = cat

        schema_data = {k: v for k, v in part.items() if k not in CORE_KEYS}

        Component.objects.create(
            pid=pid,
            category=category_map[cat_slug],
            name=part.get('name', ''),
            manufacturer=part.get('manufacturer', 'Unknown'),
            description=part.get('description', ''),
            link=part.get('link', ''),
            image_file=part.get('image_file', ''),
            manual_link=part.get('manual_link', ''),
            approx_price=part.get('approx_price', ''),
            schema_data=schema_data,
        )
        components_created += 1

    # 3. Seed drone models from schema + seed file
    models_created = 0
    # Schema models first (example models)
    for model_data in _load_drone_models():
        if _create_drone_model(model_data):
            models_created += 1
    # Golden seed models (curated real builds)
    for model_data in _load_seed_drone_models():
        if _create_drone_model(model_data):
            models_created += 1

    # 4. Seed build guides from seed file
    guides_created = 0
    drone_model_map = {m.pid: m for m in DroneModel.objects.all()}
    for guide_data in _load_seed_build_guides():
        pid = guide_data.get('pid')
        if not pid:
            continue

        # Resolve drone model FK by PID
        drone_model = drone_model_map.get(guide_data.get('drone_model_pid'))

        guide = BuildGuide.objects.create(
            pid=pid,
            name=guide_data.get('name', ''),
            description=guide_data.get('description', ''),
            difficulty=guide_data.get('difficulty', 'beginner'),
            estimated_time_minutes=guide_data.get('estimated_time_minutes', 60),
            drone_class=guide_data.get('drone_class', ''),
            thumbnail=guide_data.get('thumbnail', ''),
            drone_model=drone_model,
            required_tools=guide_data.get('required_tools', []),
            settings=guide_data.get('settings', {}),
        )

        # Create steps for this guide
        for step_data in guide_data.get('steps', []):
            BuildGuideStep.objects.create(
                guide=guide,
                order=step_data.get('order', 0),
                title=step_data.get('title', 'Untitled'),
                description=step_data.get('description', ''),
                safety_warning=step_data.get('safety_warning', ''),
                media=step_data.get('media', []),
                stl_file=step_data.get('stl_file', ''),
                betaflight_cli=step_data.get('betaflight_cli', ''),
                step_type=step_data.get('step_type', 'assembly'),
                estimated_time_minutes=step_data.get('estimated_time_minutes', 5),
                required_components=step_data.get('required_components', []),
            )

        guides_created += 1

    result['categories'] = Category.objects.count()
    result['components'] = components_created
    result['drone_models'] = models_created
    result['build_guides'] = guides_created
    return result


def _load_schema_components():
    """Load the single-example components from the schema file."""
    if not os.path.exists(SCHEMA_PATH):
        return {}
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = json.load(f)
    return schema.get('components', {})


@transaction.atomic
def seed_examples():
    """
    Wipe and re-seed from the single-example entries in drone_parts_schema_v3.json.
    This is the lightweight reset (1 example per category).

    Returns:
        dict with counts matching seed_golden() signature.
    """
    result = {
        'deleted_components': Component.objects.count(),
        'deleted_models': DroneModel.objects.count(),
        'categories': 0,
        'components': 0,
        'drone_models': 0,
        'build_guides': 0,
    }

    BuildGuide.objects.all().delete()
    Component.objects.all().delete()
    DroneModel.objects.all().delete()
    Category.objects.all().delete()

    schema_components = _load_schema_components()
    components_created = 0
    for cat_slug, items in schema_components.items():
        category = Category.objects.create(
            name=cat_slug.replace('_', ' ').title(),
            slug=cat_slug,
        )
        for item in items:
            pid = item.get('pid')
            if not pid:
                continue
            schema_data = {k: v for k, v in item.items() if k not in CORE_KEYS}
            Component.objects.create(
                pid=pid,
                category=category,
                name=item.get('name', ''),
                manufacturer=item.get('manufacturer', 'Unknown'),
                description=item.get('description', ''),
                link=item.get('link', ''),
                image_file=item.get('image_file', ''),
                manual_link=item.get('manual_link', ''),
                approx_price=item.get('approx_price', ''),
                schema_data=schema_data,
            )
            components_created += 1

    models_created = 0
    for model_data in _load_drone_models():
        if _create_drone_model(model_data):
            models_created += 1

    result['categories'] = Category.objects.count()
    result['components'] = components_created
    result['drone_models'] = models_created
    return result
