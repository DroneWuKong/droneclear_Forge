"""
Production settings — debug off, locked-down hosts, strict CORS.
Set DJANGO_SETTINGS_MODULE=droneclear_backend.settings.prod
"""

from .base import *  # noqa: F401, F403
import os

DEBUG = False

# Must be set in the .env / environment on the production server
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '').split(',')

# Restrict CORS to your actual front-end domain(s)
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
    if origin.strip()
]

# CSRF trusted origins — required for Django 4+ behind reverse proxies (Railway, Render, etc.)
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CSRF_TRUSTED_ORIGINS', os.environ.get('CORS_ALLOWED_ORIGINS', '')).split(',')
    if origin.strip()
]

# Security hardening
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# WhiteNoise static file compression and caching
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
