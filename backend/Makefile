# Makefile for DigitalBookLLM Backend
# For Windows, install: choco install make
# Or use the PowerShell scripts directly

.PHONY: help up down logs build dev clean restart migrate health

help: ## Show this help message
	@echo "DigitalBookLLM Backend - Docker Commands"
	@echo "========================================"
	@echo ""
	@echo "Available commands:"
	@echo "  make up        - Start production services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View logs (follow mode)"
	@echo "  make build     - Rebuild and start services"
	@echo "  make dev       - Start development mode"
	@echo "  make restart   - Restart all services"
	@echo "  make clean     - Remove containers and volumes"
	@echo "  make health    - Check service health"
	@echo "  make migrate   - Run database migrations"
	@echo ""

up: ## Start production services
	docker-compose up -d
	@echo "✅ Services started"
	@echo "🌐 Backend: http://localhost:3001"
	@echo "🗄️  PostgreSQL: localhost:5433"

down: ## Stop all services
	docker-compose down

logs: ## View logs (follow mode)
	docker-compose logs -f

build: ## Rebuild and start services
	docker-compose up -d --build

dev: ## Start development mode with hot reload
	docker-compose -f docker-compose.dev.yml up

dev-down: ## Stop development services
	docker-compose -f docker-compose.dev.yml down

restart: ## Restart all services
	docker-compose restart

clean: ## Remove containers, networks, and volumes
	docker-compose down -v
	@echo "⚠️  All data has been removed"

health: ## Check service health
	@echo "Checking backend health..."
	@curl -f http://localhost:3001/health || echo "❌ Backend not responding"
	@echo ""
	@echo "Checking database..."
	@docker-compose exec postgres pg_isready -U postgres || echo "❌ Database not ready"

migrate: ## Run database migrations in container
	docker-compose exec backend npm run migrate

shell: ## Access backend container shell
	docker-compose exec backend sh

db-shell: ## Access PostgreSQL shell
	docker-compose exec postgres psql -U postgres -d digitalbookllm

backup: ## Backup database
	docker-compose exec postgres pg_dump -U postgres digitalbookllm > backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "✅ Database backed up"

stats: ## Show container resource usage
	docker stats

ps: ## List running containers
	docker-compose ps
