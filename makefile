# ─────────────────────────────────────────────────────────────────────────────
# Personal Assistant — Makefile
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────────────────

.DEFAULT_GOAL := help
.PHONY: help install setup dev build start clean \
        db-generate db-migrate db-studio db-reset \
        test test-coverage test-watch lint typecheck

# ── Colours ──────────────────────────────────────────────────────────────────
BOLD  := \033[1m
RESET := \033[0m
GREEN := \033[32m
CYAN  := \033[36m
YELLOW := \033[33m

# ─────────────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "$(BOLD)Personal Assistant$(RESET)"
	@echo ""
	@echo "$(CYAN)Setup$(RESET)"
	@echo "  $(BOLD)make install$(RESET)       Install npm dependencies"
	@echo "  $(BOLD)make setup$(RESET)         Full first-time setup (install + env + db)"
	@echo ""
	@echo "$(CYAN)Development$(RESET)"
	@echo "  $(BOLD)make dev$(RESET)           Start the API server in watch mode"
	@echo "  $(BOLD)make build$(RESET)         Compile TypeScript to dist/"
	@echo "  $(BOLD)make start$(RESET)         Run compiled build"
	@echo ""
	@echo "$(CYAN)Database$(RESET)"
	@echo "  $(BOLD)make db-generate$(RESET)   Generate SQL migrations from schema changes"
	@echo "  $(BOLD)make db-migrate$(RESET)    Apply pending migrations"
	@echo "  $(BOLD)make db-studio$(RESET)     Open Drizzle Studio (browser DB viewer)"
	@echo "  $(BOLD)make db-reset$(RESET)      ⚠️  Delete database and re-migrate from scratch"
	@echo ""
	@echo "$(CYAN)Quality$(RESET)"
	@echo "  $(BOLD)make test$(RESET)          Run tests once"
	@echo "  $(BOLD)make test-coverage$(RESET) Run tests with coverage report"
	@echo "  $(BOLD)make test-watch$(RESET)    Run tests in watch mode"
	@echo "  $(BOLD)make typecheck$(RESET)     Run tsc type checking (no emit)"
	@echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────

install:
	@echo "$(GREEN)▸ Installing dependencies...$(RESET)"
	npm install

# Copies .env.example → .env only if .env doesn't already exist
.env:
	@echo "$(GREEN)▸ Creating .env from .env.example...$(RESET)"
	cp .env.example .env
	@echo "$(YELLOW)  ✎ Open .env and add your ANTHROPIC_API_KEY$(RESET)"

# Creates the data/ directory SQLite will write into
data/:
	@echo "$(GREEN)▸ Creating data/ directory...$(RESET)"
	mkdir -p data

setup: install .env data/ db-migrate
	@echo ""
	@echo "$(GREEN)$(BOLD)✓ Setup complete$(RESET)"
	@echo ""
	@echo "  Next steps:"
	@echo "  1. Add your ANTHROPIC_API_KEY to .env"
	@echo "  2. Run $(BOLD)make dev$(RESET) to start the server"
	@echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Development
# ─────────────────────────────────────────────────────────────────────────────

dev:
	@echo "$(GREEN)▸ Starting dev server...$(RESET)"
	npm run dev

build:
	@echo "$(GREEN)▸ Building...$(RESET)"
	npm run build

start: build
	@echo "$(GREEN)▸ Starting production build...$(RESET)"
	npm run start

clean:
	@echo "$(GREEN)▸ Cleaning build output...$(RESET)"
	rm -rf dist/

# ─────────────────────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────────────────────

db-generate:
	@echo "$(GREEN)▸ Generating migrations...$(RESET)"
	npm run db:generate

db-migrate: data/
	@echo "$(GREEN)▸ Running migrations...$(RESET)"
	npm run db:migrate

db-studio:
	@echo "$(GREEN)▸ Opening Drizzle Studio...$(RESET)"
	npm run db:studio

db-reset:
	@echo "$(YELLOW)$(BOLD)⚠️  This will delete all data in data/assistant.db$(RESET)"
	@read -p "  Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "$(GREEN)▸ Resetting database...$(RESET)"
	rm -f data/assistant.db
	$(MAKE) db-migrate
	@echo "$(GREEN)✓ Database reset$(RESET)"

# ─────────────────────────────────────────────────────────────────────────────
# Quality
# ─────────────────────────────────────────────────────────────────────────────

test:
	@echo "$(GREEN)▸ Running tests...$(RESET)"
	npm run test

test-coverage:
	@echo "$(GREEN)▸ Running tests with coverage...$(RESET)"
	npm run test:coverage

test-watch:
	npm run test:watch

typecheck:
	@echo "$(GREEN)▸ Type checking...$(RESET)"
	npx tsc --noEmit
