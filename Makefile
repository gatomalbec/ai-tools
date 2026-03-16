SHELL := /usr/bin/env bash

LOCAL_BIN ?= $(HOME)/.local/bin
SAFE_PI_LINK ?= $(LOCAL_BIN)/safe-pi

.PHONY: help install-safe-pi vm-up vm-shell vm-run vm-stop vm-destroy vm-status test-rlm

help:
	@echo "Targets:"
	@echo "  make install-safe-pi          # symlink scripts/safe-pi to ~/.local/bin/safe-pi"
	@echo "  make vm-up|vm-shell|vm-run|vm-stop|vm-destroy|vm-status"
	@echo "  make test-rlm                 # run packages/rlm tests"

install-safe-pi:
	@mkdir -p "$(LOCAL_BIN)"
	@ln -snf "$(PWD)/scripts/safe-pi" "$(SAFE_PI_LINK)"
	@chmod +x "$(PWD)/scripts/safe-pi" "$(PWD)/scripts/safe-pi-vm.sh"
	@echo "Installed safe-pi -> $(SAFE_PI_LINK)"

vm-up:
	@./scripts/safe-pi-vm.sh up

vm-shell:
	@./scripts/safe-pi-vm.sh shell

vm-run:
	@./scripts/safe-pi-vm.sh run

vm-stop:
	@./scripts/safe-pi-vm.sh stop

vm-destroy:
	@./scripts/safe-pi-vm.sh destroy

vm-status:
	@./scripts/safe-pi-vm.sh status

test-rlm:
	npm test -w packages/rlm
