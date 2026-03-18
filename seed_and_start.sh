#!/bin/bash
# Run this ONCE after first deploy to seed the parts database.
# In Railway: Settings → Deploy → Custom Start Command (temporarily):
#   bash seed_and_start.sh
# After first successful deploy, switch back to the Procfile.

echo "══════════════════════════════════════"
echo "  Forge — Initial Database Seed"
echo "══════════════════════════════════════"

python manage.py migrate
python manage.py reset_to_golden
python manage.py collectstatic --noinput

echo ""
echo "  ✓ Database seeded with 3,128 parts"
echo "  ✓ Static files collected"
echo "  Starting Gunicorn..."
echo ""

gunicorn droneclear_backend.wsgi --bind 0.0.0.0:$PORT
