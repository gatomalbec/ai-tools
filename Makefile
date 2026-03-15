SHELL := /usr/bin/env bash

PRUNE_UNSELECTED ?= false
REPLACE_TOP_LEVEL_LINKS ?= false
OVERWRITE_FOREIGN_LINKS ?= false

.PHONY: help configure install bootstrap status

help:
	@echo "Targets:"
	@echo "  make configure SKILLS=\"...\" EXTENSIONS=\"...\""
	@echo "  make install [PRUNE_UNSELECTED=false] [REPLACE_TOP_LEVEL_LINKS=false] [OVERWRITE_FOREIGN_LINKS=false]"
	@echo "  make bootstrap   # checks required tools, creates defaults, runs install"
	@echo "  make status"

configure:
	@./scripts/configure-pi-agent.sh

install:
	@PI_AGENT_PRUNE_UNSELECTED="$(PRUNE_UNSELECTED)" \
	 PI_AGENT_REPLACE_TOP_LEVEL_LINKS="$(REPLACE_TOP_LEVEL_LINKS)" \
	 PI_AGENT_OVERWRITE_FOREIGN_LINKS="$(OVERWRITE_FOREIGN_LINKS)" \
	 ./scripts/install-pi-agent.sh

bootstrap:
	@PI_AGENT_PRUNE_UNSELECTED="$(PRUNE_UNSELECTED)" \
	 PI_AGENT_REPLACE_TOP_LEVEL_LINKS="$(REPLACE_TOP_LEVEL_LINKS)" \
	 PI_AGENT_OVERWRITE_FOREIGN_LINKS="$(OVERWRITE_FOREIGN_LINKS)" \
	 ./scripts/bootstrap-pi-agent.sh

status:
	@echo "Config file: $${PI_AGENT_CONFIG:-$(PWD)/.pi-agent-selection.mk}"
	@if [[ -f "$${PI_AGENT_CONFIG:-.pi-agent-selection.mk}" ]]; then cat "$${PI_AGENT_CONFIG:-.pi-agent-selection.mk}"; else echo "(missing; defaults to all)"; fi
	@echo
	@echo "~/.pi/agent/skills:"; ls -la "$${PI_AGENT_DIR:-$$HOME/.pi/agent}/skills" 2>/dev/null || true
	@echo
	@echo "~/.pi/agent/extensions:"; ls -la "$${PI_AGENT_DIR:-$$HOME/.pi/agent}/extensions" 2>/dev/null || true

