SHELL := /usr/bin/env bash

PRUNE_UNSELECTED ?= false
REPLACE_TOP_LEVEL_LINKS ?= false
OVERWRITE_FOREIGN_LINKS ?= false

.PHONY: help configure install bootstrap status vm-up vm-shell vm-run vm-stop vm-destroy vm-status safe-pi

help:
	@echo "Targets:"
	@echo "  make configure SKILLS=\"...\" EXTENSIONS=\"...\""
	@echo "  make install [PRUNE_UNSELECTED=false] [REPLACE_TOP_LEVEL_LINKS=false] [OVERWRITE_FOREIGN_LINKS=false]"
	@echo "  make bootstrap   # checks required tools, creates defaults, runs install"
	@echo "  make status"
	@echo "  make vm-up       # start/create disposable NixOS VM on macOS"
	@echo "  make vm-shell    # open shell in VM at /workspace"
	@echo "  make vm-run VM_ARGS=\"...\"   # run pi in VM (flake-aware)"
	@echo "  make safe-pi VM_ARGS=\"...\"  # same as vm-run (host safe-pi wrapper behavior)"
	@echo "  make vm-stop     # stop VM"
	@echo "  make vm-destroy  # delete VM for clean recreate"
	@echo "  make vm-status   # show Lima instances"

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

vm-up:
	@./scripts/pi-agent-vm.sh up

vm-shell:
	@./scripts/pi-agent-vm.sh shell

vm-run:
	@./scripts/pi-agent-vm.sh run $(VM_ARGS)

safe-pi:
	@./scripts/safe-pi $(VM_ARGS)

vm-stop:
	@./scripts/pi-agent-vm.sh stop

vm-destroy:
	@./scripts/pi-agent-vm.sh destroy

vm-status:
	@./scripts/pi-agent-vm.sh status
