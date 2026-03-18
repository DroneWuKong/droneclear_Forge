# Deploying Forge to PythonAnywhere

> Forge — Powered by DroneClear
> Based on Ted Strazimiri's deployment guide.

---

## Quick Reference

| Item | Value |
|------|-------|
| App URL | `https://YOUR_USERNAME.pythonanywhere.com` |
| Project path | `/home/YOUR_USERNAME/droneclear_Forge` |
| Virtualenv | `/home/YOUR_USERNAME/.virtualenvs/forge-venv` |
| Settings module | `droneclear_backend.settings.prod` |
| Static mapping | `/static/` → `/home/YOUR_USERNAME/droneclear_Forge/staticfiles/` |
| Media mapping | `/media/` → `/home/YOUR_USERNAME/droneclear_Forge/media/` |
| Source repo | `https://github.com/DroneWuKong/droneclear_Forge` |

---

## One-Shot Setup (copy-paste into PythonAnywhere Bash console)

Replace `YOUR_USERNAME` with your PythonAnywhere username before running.

```bash
# ── 1. Clone ──
cd ~
git clone https://github.com/DroneWuKong/droneclear_Forge.git
cd droneclear_Forge

# ── 2. Virtual environment ──
python3.10 -m venv ~/.virtualenvs/forge-venv
source ~/.virtualenvs/forge-venv/bin/activate

# ── 3. Install dependencies ──
pip install -r requirements.txt

# ── 4. Generate secret key and create .env ──
SECRET=$(python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")

cat > .env << EOF
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod
DJANGO_SECRET_KEY=${SECRET}
DJANGO_ALLOWED_HOSTS=YOUR_USERNAME.pythonanywhere.com
CORS_ALLOWED_ORIGINS=https://YOUR_USERNAME.pythonanywhere.com
EOF

echo "Secret key generated and .env created."

# ── 5. Database setup + seed with 3,128 vetted parts ──
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod python manage.py migrate
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod python manage.py reset_to_golden

# ── 6. Collect static files ──
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod python manage.py collectstatic --noinput

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Forge backend ready. Now configure the Web tab:"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  1. Web tab → Add new web app → Manual config → Python 3.10"
echo "  2. Virtualenv: /home/YOUR_USERNAME/.virtualenvs/forge-venv"
echo "  3. WSGI file: paste contents from below"
echo "  4. Static: /static/ → /home/YOUR_USERNAME/droneclear_Forge/staticfiles/"
echo "  5. Static: /media/ → /home/YOUR_USERNAME/droneclear_Forge/media/"
echo "  6. Click Reload"
echo ""
```

---

## WSGI File Contents

Replace the entire contents of your WSGI config file with:

```python
import os
import sys

project_home = '/home/YOUR_USERNAME/droneclear_Forge'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_home, '.env'))

os.environ['DJANGO_SETTINGS_MODULE'] = 'droneclear_backend.settings.prod'

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```

---

## Updating After Code Changes

```bash
cd ~/droneclear_Forge
git pull origin master
source ~/.virtualenvs/forge-venv/bin/activate
pip install -r requirements.txt
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod python manage.py migrate
DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod python manage.py collectstatic --noinput
```

Then click **Reload** on the PythonAnywhere Web tab.

---

## Credits

- **Ted Strazimiri** — DroneClear creator, parts database, compatibility engine, schema design
- **Drone Integration Handbook** — https://github.com/DroneWuKong/drone-integration-handbook
