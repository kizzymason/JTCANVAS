# Production deployment verification

- Deployed frontend and API/worker images to `jingtiang.com` using the existing Compose files and environment. PostgreSQL and Redis were not recreated.
- Applied migration 0011 (12 migration records total). Explicitly initialized the empty homepage with four published brand works; verified `homepage.initialize` audit entry for `deployment:gravity`.
- API health, public homepage and brand image returned 200; anonymous admin homepage returned 401; an unreferenced public-media key returned 404.
- API healthy; worker running with zero restarts. No generation or payment requests were made by these checks.
- Backup: `/opt/jtcanvas-backups/gravity-before` contains the database dump and source/config archive. Previous images retained as `infinite-canvas:gravity-rollback` and `infinite-canvas-server:gravity-rollback`.
- The first switch was reverted because Compose `--wait` rejects the worker's intentionally disabled healthcheck. Deployment now waits for API/web, then starts and separately inspects the worker.
- Existing workspace business changes were preserved. Local homepage tests: 39 passed (7 isolated PostgreSQL tests). Mocked browser checks: 42 route visits passed. Server and frontend production builds passed; the existing large frontend chunk warning remains.
- Live browser checks are recorded separately in ignored `qa/`; authenticated generation, payment, storage integrations and Agent connections still require manual verification in pending-test.

- Live Edge checks through SSH forwarding to the production web container passed at 1440 and 390 widths: media, login modal, cool background, no overflow or script errors. Direct public-domain browser loading was slow from this machine; public HTTP endpoints were checked separately. Repeating initialization correctly skipped existing content.
- Final web image: sha256:59ef669cec563503cfce0126ece2b09817989cde2ba82876ec6de9986d135ccf. Startup HTML now applies frontend dark styling before React loads, while preserving administrator theme preferences.

## Homepage cache and workbench adjustments

- Browser cache now retains brand media for one week with stale-while-revalidate. Homepage rendering waits for the hero, visible feature images and showcase covers to decode.
- Production uses local file storage. Public homepage uploads are revalidated against current homepage publication state and use ETags; expired S3 redirects are deliberately left uncached.
- Generation history now uses a 420px right-side drawer with a visible close control. The fixed-width site sidebar no longer has or persists a collapsed state.
- Validation: 34 homepage controller/service tests and 44 mocked Edge route visits passed; server TypeScript and Vite production builds passed. Production returned HTTP 200 for health/brand imagery, 401 for anonymous homepage administration, and 404 for an unreferenced media key. API/web are healthy and worker runs without restarts.
- Follow-up production image IDs: web `sha256:f591b140e34a6742fd2d25b50eec89172e3a012b64048f76fc82dc7559137a47`; API/worker `sha256:10535109b927c1ad051b731ac99ba04cbdd4851ab0d6d01ae31282bf7388919b`. Previous live images remain tagged `gravity-followup-rollback`.
