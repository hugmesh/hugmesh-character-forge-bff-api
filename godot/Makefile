# Godot build orchestration for the Character Forge 3D maker.
#
# The Web export publishes into hugmesh.games via the standard hot-upload
# zip (manifest.json v2 + register.sql + bundle/ — docs/wiki/howto/add-game.md
# Path A in that repo). `make export-web` is GUARDED on export-template
# availability: build lanes never download templates (orchestrator owns
# exports), so a machine without matching templates gets a clear skip message
# and a zero exit instead of a half-written bundle.

GODOT ?= godot
PROJECT_DIR := character-forge
PRESET := Character-Forge
BUILD_DIR := $(PROJECT_DIR)/build
BUNDLE_DIR := $(BUILD_DIR)/bundle
ZIP := $(BUILD_DIR)/character-forge-bundle.zip

# Template dir name = version prefix up to and including ".stable"
# (e.g. "4.7.stable.gentoo.5b4e0cb0f" -> "4.7.stable").
TEMPLATE_ROOT := $(HOME)/.local/share/godot/export_templates

.PHONY: export-web import check test clean

## Godot import pass — parses every script + imports resources (CI sanity).
import:
	$(GODOT) --headless --path $(PROJECT_DIR) --import

## Headless behavior tests (sanitize clamps, 29-family rig distinctness,
## expression/jaw math, seeded-randomizer determinism, scene smoke).
## Non-zero exit on any failing assertion.
test:
	$(GODOT) --headless --path $(PROJECT_DIR) -s res://tests/run_tests.gd

## Parse-check each GDScript individually (fast feedback without an export).
check:
	@set -e; \
	for f in $(PROJECT_DIR)/scripts/*.gd; do \
		echo "check $$f"; \
		$(GODOT) --headless --path $(PROJECT_DIR) --check-only -s "res://scripts/$$(basename $$f)"; \
	done

## Web export + upload-zip assembly. Skips (exit 0) when the Godot binary or
## its matching export templates are absent — the orchestrator runs the real
## export with pinned templates.
export-web:
	@command -v $(GODOT) >/dev/null 2>&1 || { \
		echo "export-web SKIPPED: '$(GODOT)' not found in PATH"; exit 0; }; \
	VERSION=$$($(GODOT) --version 2>/dev/null | sed -nE 's/^([0-9]+\.[0-9]+(\.[0-9]+)?\.stable).*/\1/p'); \
	if [ -z "$$VERSION" ]; then \
		echo "export-web SKIPPED: could not parse a stable version from '$(GODOT) --version'"; exit 0; \
	fi; \
	TPL="$(TEMPLATE_ROOT)/$$VERSION"; \
	if [ ! -f "$$TPL/web_nothreads_release.zip" ] && [ ! -f "$$TPL/web_release.zip" ]; then \
		echo "export-web SKIPPED: no Web export templates under $$TPL"; \
		echo "  (threads are OFF for this preset — web_nothreads_release.zip is the one needed;"; \
		echo "   install matching templates or let the orchestrator export)"; exit 0; \
	fi; \
	echo "Exporting $(PRESET) with Godot $$VERSION ..."; \
	mkdir -p $(BUNDLE_DIR); \
	$(GODOT) --headless --path $(PROJECT_DIR) --export-release "$(PRESET)" build/bundle/index.html; \
	test -s $(BUNDLE_DIR)/index.wasm || { echo "export FAILED: $(BUNDLE_DIR)/index.wasm missing/empty"; exit 1; }; \
	test -s $(BUNDLE_DIR)/index.pck || { echo "export FAILED: $(BUNDLE_DIR)/index.pck missing/empty"; exit 1; }; \
	cp $(PROJECT_DIR)/register/manifest.json $(PROJECT_DIR)/register/register.sql $(BUILD_DIR)/; \
	rm -f $(ZIP); \
	cd $(BUILD_DIR) && zip -r $(notdir $(ZIP)) manifest.json register.sql bundle >/dev/null; \
	echo "Upload zip ready: $(ZIP)"

clean:
	rm -rf $(BUILD_DIR)
