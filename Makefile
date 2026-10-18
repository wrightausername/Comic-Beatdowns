.PHONY: setup run api ui check test e2e token doctor

setup:
	bash scripts/setup.sh

run:
	.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

api:
	.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend

ui:
	npm --prefix frontend run dev -- --port 5173 --strictPort

check:
	.venv/bin/ruff check backend scripts
	.venv/bin/ruff format --check backend scripts
	.venv/bin/pytest backend -q
	npm --prefix frontend test
	npm --prefix frontend run format:check
	npm --prefix frontend run build

test:
	.venv/bin/pytest backend -q
	npm --prefix frontend test

e2e:
	npm --prefix frontend run test:e2e

# Run locally yourself; do not paste the output into logs, issues, or chat.
token:
	@.venv/bin/python scripts/show_token.py

doctor:
	.venv/bin/python scripts/check_ready.py
