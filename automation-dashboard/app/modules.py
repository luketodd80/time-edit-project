"""Dashboard tabs.

The time-edit app is planned as another tab in this same dashboard. To add one:

1. Append a module here (id, label, endpoint).
2. Add a `<div class="wrap hidden" id="{id}View">` in templates/index.html.
3. Register its page section and `/api/...` routes in app/web.py (or a new blueprint).
4. Teach `showTab` in the template about the new view id.

Each module owns its own routes and its own tables. Shared pieces are the login
cookie, the DATA_DIR store, and the tab bar.
"""

MODULES = [
    {"id": "daily", "label": "Today / Daily runs", "endpoint": "/api/runs"},
    {"id": "all", "label": "All automations", "endpoint": "/api/automations"},
    {"id": "od", "label": "On demand / Month-end", "endpoint": "/api/monthend"},
]
