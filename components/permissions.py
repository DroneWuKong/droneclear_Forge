"""
API key authentication for DroneClear.

SEC-001: All API endpoints require a valid API key in the X-API-Key header.
Set DRONECLEAR_API_KEY in your environment / .env file.

Read-only endpoints (GET) on component/model viewsets are exempt to allow
the static frontend to fetch data without auth.
"""

import os
from rest_framework.permissions import BasePermission


def _get_api_key():
    return os.environ.get('DRONECLEAR_API_KEY', '')


class HasAPIKey(BasePermission):
    """
    Allows access if:
    - Request is a safe/read-only method (GET, HEAD, OPTIONS), OR
    - Request includes a valid X-API-Key header matching DRONECLEAR_API_KEY env var.

    If DRONECLEAR_API_KEY is not set, all requests are allowed (dev mode)
    with a console warning on first denied request.
    """
    _warned = False

    def has_permission(self, request, view):
        # Read-only requests are always allowed (static frontend needs these)
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True

        api_key = _get_api_key()

        # If no key configured, allow everything but warn
        if not api_key:
            if not HasAPIKey._warned:
                import warnings
                warnings.warn(
                    "DRONECLEAR_API_KEY not set — all write requests allowed. "
                    "Set this env var in production.",
                    RuntimeWarning,
                )
                HasAPIKey._warned = True
            return True

        # Check header
        provided = request.META.get('HTTP_X_API_KEY', '')
        return provided == api_key


class IsMaintenanceAllowed(BasePermission):
    """
    Stricter permission for maintenance endpoints (restart, reset, schema write).
    Requires API key even for GET requests.
    """

    def has_permission(self, request, view):
        api_key = _get_api_key()
        if not api_key:
            return True  # Dev mode
        provided = request.META.get('HTTP_X_API_KEY', '')
        return provided == api_key
