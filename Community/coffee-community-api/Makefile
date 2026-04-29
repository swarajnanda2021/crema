# Crema API — local development conveniences.
#
# `--host 0.0.0.0` is the important flag: it makes uvicorn listen on
# every network interface (including the Mac's LAN IP), so the iPhone
# running Expo Go on the same Wi-Fi can reach the backend. Without it
# the server only binds to 127.0.0.1 and the phone gets "network
# request failed" because it tries to reach `localhost` on itself.
#
# `--reload` watches the Python source and re-imports on save.
#
# Production (Fly) ignores this Makefile entirely — the Docker entry
# point in the Dockerfile sets the same host/port for the prod
# container. See LAUNCH_TODO §1.3.

.PHONY: dev install seed-cafes

# Default: start uvicorn with LAN bind + reload. Run from this folder.
dev:
	uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Install / refresh the venv from requirements.txt. Use after pulling
# changes that touch requirements.txt (e.g. adding python-dotenv).
install:
	pip install -r requirements.txt

# Seed the 9 Goa pilot cafés (idempotent — re-running is a no-op).
seed-cafes:
	python seed_cafes.py
