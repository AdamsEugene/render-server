// ============================================
// HOVER ELEMENT DETECTOR - Chrome Extension Version
// ============================================

(function () {
  "use strict";

  // Notify extension about step changes
  function notifyExtension(stepInfo) {
    window.postMessage(
      {
        type: "MENU_DISCOVERY_STEP",
        ...stepInfo,
      },
      "*"
    );
  }

  const HoverDetector = {
    // Configuration
    config: {
      hoverDelay: 5000,
      debug: true,
      outlineColor: "#8b5cf6",
      outlineColorMenu: "#10b981",
      outlineWidth: "3px",
    },

    // State
    state: {
      hoverTimeout: null,
      currentElement: null,
      headerElement: null,
      navElement: null,
      savedTargetElement: null,
      savedMenuElement: null,
      isConfirming: false,
      isConfirmingMenu: false,
      isFrozen: false,
      elementPath: [],
      menuPath: [],
      currentPathIndex: 0,
      mutationObserver: null,
      detectedMenuElements: [],
      menuHoverHandler: null,
      ourOutlinedElements: new Set(),
      elementChangeCount: new Map(),
      // Snippet generation state
      capturedTargetState: null,
      capturedMenuState: null,
      targetSelector: null,
      menuSelector: null,
    },

    // Console styling
    styles: {
      title:
        "color: #fff; background: linear-gradient(90deg, #00C48C 0%, #14B8A6 100%); font-size: 14px; font-weight: bold; padding: 8px 12px; border-radius: 4px;",
      success: "color: #00C48C; font-size: 12px; font-weight: bold;",
      info: "color: #14B8A6; font-size: 11px;",
      warn: "color: #f59e0b; font-size: 11px;",
      error: "color: #ef4444; font-size: 12px; font-weight: bold;",
      highlight: "color: #8b5cf6; font-size: 11px; font-weight: bold;",
      muted: "color: #6b7280; font-size: 10px;",
      element:
        "color: #ec4899; font-size: 11px; background: #fdf2f8; padding: 2px 6px; border-radius: 3px;",
      prompt:
        "color: #fff; background: #8b5cf6; font-size: 12px; font-weight: bold; padding: 6px 10px; border-radius: 4px;",
      promptMenu:
        "color: #fff; background: #10b981; font-size: 12px; font-weight: bold; padding: 6px 10px; border-radius: 4px;",
      frozen:
        "color: #fff; background: #ef4444; font-size: 12px; font-weight: bold; padding: 6px 10px; border-radius: 4px;",
      snippet:
        "color: #fff; background: #2563eb; font-size: 12px; font-weight: bold; padding: 6px 10px; border-radius: 4px;",
    },

    // Logger utility
    log: {
      title(msg) {
        console.log(`%c🎯 ${msg}`, HoverDetector.styles.title);
      },
      success(msg) {
        console.log(`%c✓ ${msg}`, HoverDetector.styles.success);
      },
      info(msg, data = null) {
        if (data !== null)
          console.log(`%c○ ${msg}`, HoverDetector.styles.info, data);
        else console.log(`%c○ ${msg}`, HoverDetector.styles.info);
      },
      warn(msg) {
        console.log(`%c⚠ ${msg}`, HoverDetector.styles.warn);
      },
      error(msg) {
        console.log(`%c✗ ${msg}`, HoverDetector.styles.error);
      },
      highlight(msg) {
        console.log(`%c★ ${msg}`, HoverDetector.styles.highlight);
      },
      muted(msg) {
        console.log(`%c  ${msg}`, HoverDetector.styles.muted);
      },
      element(label, el) {
        if (!el) return;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const classes =
          el.className && typeof el.className === "string"
            ? `.${el.className.split(" ").join(".")}`
            : "";
        console.log(
          `%c${label}: %c${tag}${id}${classes}`,
          HoverDetector.styles.info,
          HoverDetector.styles.element
        );
      },
      divider() {
        console.log(
          "%c─────────────────────────────────",
          HoverDetector.styles.muted
        );
      },
      prompt(msg) {
        console.log(`%c❓ ${msg}`, HoverDetector.styles.prompt);
      },
      promptMenu(msg) {
        console.log(`%c❓ ${msg}`, HoverDetector.styles.promptMenu);
      },
      frozen(msg) {
        console.log(`%c🔒 ${msg}`, HoverDetector.styles.frozen);
      },
      snippet(msg) {
        console.log(`%c📋 ${msg}`, HoverDetector.styles.snippet);
      },
    },

    // ============================================
    // SELECTOR GENERATION UTILITIES
    // ============================================
    selector: {
      generate(element, dom = document) {
        if (!element) return null;
        if (element.id) return `#${CSS.escape(element.id)}`;

        const meaningfulClasses = this.getMeaningfulClasses(element);
        if (meaningfulClasses.length > 0) {
          const fullSelector = meaningfulClasses
            .map((c) => `.${CSS.escape(c)}`)
            .join("");
          const matches = dom.querySelectorAll(fullSelector);
          if (matches.length === 1) return fullSelector;

          for (let i = meaningfulClasses.length; i >= 1; i--) {
            const subset = meaningfulClasses.slice(0, i);
            const selector = subset.map((c) => `.${CSS.escape(c)}`).join("");
            const subMatches = dom.querySelectorAll(selector);
            if (subMatches.length === 1) return selector;
          }
          return fullSelector;
        }

        let current = element.parentElement;
        while (current && current !== dom.body) {
          if (current.id) {
            const parentId = `#${CSS.escape(current.id)}`;
            const childClasses = this.getMeaningfulClasses(element);
            if (childClasses.length > 0) {
              return `${parentId} ${childClasses
                .map((c) => `.${CSS.escape(c)}`)
                .join("")}`;
            }
          }
          current = current.parentElement;
        }

        if (element.className && typeof element.className === "string") {
          const allClasses = element.className
            .split(" ")
            .filter((c) => c.trim());
          if (allClasses.length > 0)
            return allClasses.map((c) => `.${CSS.escape(c)}`).join("");
        }
        return null;
      },

      getMeaningfulClasses(element) {
        if (!element.className || typeof element.className !== "string")
          return [];
        const dynamicPatterns = [
          /^is-/,
          /^has-/,
          /^active/,
          /^open/,
          /^show/,
          /^visible/,
          /^expanded/,
          /^hover/,
          /^focus/,
          /^selected/,
          /^current/,
          /-active$/,
          /-open$/,
          /-visible$/,
          /-expanded$/,
        ];
        return element.className.split(" ").filter((cls) => {
          if (!cls.trim()) return false;
          return !dynamicPatterns.some((pattern) => pattern.test(cls));
        });
      },
    },

    // ============================================
    // STATE CAPTURE UTILITIES
    // ============================================
    stateCapture: {
      capture(element) {
        if (!element) return null;
        const computedStyle = window.getComputedStyle(element);
        return {
          classes: element.className
            ? element.className.split(" ").filter((c) => c.trim())
            : [],
          attributes: {
            "aria-expanded": element.getAttribute("aria-expanded"),
            "aria-hidden": element.getAttribute("aria-hidden"),
            open: element.hasAttribute("open"),
            "data-state": element.getAttribute("data-state"),
          },
          styles: {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            transform: computedStyle.transform,
            maxHeight: computedStyle.maxHeight,
            height: computedStyle.height,
            pointerEvents: computedStyle.pointerEvents,
          },
          tagName: element.tagName.toLowerCase(),
        };
      },
    },

    // ============================================
    // SNIPPET GENERATOR
    // ============================================
    snippetGenerator: {
      generate() {
        const { state, log, selector, stateCapture } = HoverDetector;
        if (!state.savedTargetElement || !state.savedMenuElement) {
          log.error("Cannot generate snippet - missing target or menu element");
          return null;
        }

        const targetSelector = selector.generate(state.savedTargetElement);
        const menuSelector = selector.generate(state.savedMenuElement);
        const targetHoverState = stateCapture.capture(state.savedTargetElement);
        const menuHoverState = stateCapture.capture(state.savedMenuElement);

        state.targetSelector = targetSelector;
        state.menuSelector = menuSelector;
        state.capturedTargetState = targetHoverState;
        state.capturedMenuState = menuHoverState;

        return this.buildSnippet(
          targetSelector,
          menuSelector,
          targetHoverState,
          menuHoverState
        );
      },

      buildSnippet(targetSelector, menuSelector, targetState, menuState) {
        const targetClasses = targetState.classes.filter((c) =>
          /active|open|hover|expanded|is-|has-|show|visible/.test(c)
        );
        const menuClasses = menuState.classes.filter((c) =>
          /active|open|hover|expanded|is-|has-|show|visible/.test(c)
        );

        const menuStyles = {};
        if (menuState.styles.display !== "none")
          menuStyles.display = menuState.styles.display;
        if (menuState.styles.visibility === "visible")
          menuStyles.visibility = "visible";
        if (parseFloat(menuState.styles.opacity) > 0)
          menuStyles.opacity = menuState.styles.opacity;
        if (menuState.styles.pointerEvents === "auto")
          menuStyles.pointerEvents = "auto";
        if (menuState.styles.maxHeight && menuState.styles.maxHeight !== "0px")
          menuStyles.maxHeight = menuState.styles.maxHeight;
        if (menuState.styles.transform && menuState.styles.transform !== "none")
          menuStyles.transform = menuState.styles.transform;

        const targetAttrs = {};
        if (targetState.attributes["aria-expanded"] === "true")
          targetAttrs["aria-expanded"] = "true";
        if (targetState.attributes.open) targetAttrs.open = true;

        const menuAttrs = {};
        if (menuState.attributes["aria-hidden"] === "false")
          menuAttrs["aria-hidden"] = "false";

        return `
// ============================================
// MENU HOVER TEST SNIPPET
// Generated by Heatmap Menu Discovery
// ============================================

(function() {
  const config = {
    targetSelector: ${JSON.stringify(targetSelector)},
    menuSelector: ${JSON.stringify(menuSelector)},
    targetClasses: ${JSON.stringify(targetClasses)},
    menuClasses: ${JSON.stringify(menuClasses)},
    targetStyles: ${JSON.stringify({})},
    menuStyles: ${JSON.stringify(menuStyles)},
    targetAttrs: ${JSON.stringify(targetAttrs)},
    menuAttrs: ${JSON.stringify(menuAttrs)},
    targetIsDetails: ${targetState.tagName === "details"},
  };

  console.log("%c🎯 Menu Test Snippet", "color: #fff; background: #00C48C; padding: 8px 12px; border-radius: 4px; font-weight: bold;");
  console.log("Target:", config.targetSelector);
  console.log("Menu:", config.menuSelector);
  console.log("Styles:", config.menuStyles);
})();
`;
      },
    },

    // ============================================
    // HEADER DETECTION UTILITIES
    // ============================================
    utils: {
      isElementVisible(element) {
        if (!element) return false;
        const computedStyles = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          computedStyles.display !== "none" &&
          computedStyles.visibility !== "hidden" &&
          rect.width > 10 &&
          rect.height > 30 &&
          rect.height < 300
        );
      },

      hasSamePositionSize(ele1, ele2) {
        const rect1 = ele1.getBoundingClientRect();
        const rect2 = ele2.getBoundingClientRect();
        return (
          Math.abs(rect1.top - rect2.top) < 1 &&
          Math.abs(rect1.right - rect2.right) < 1 &&
          Math.abs(rect1.bottom - rect2.bottom) < 1 &&
          Math.abs(rect1.left - rect2.left) < 1
        );
      },

      findLargestContainer(element) {
        let current = element;
        let parent = current.parentElement;
        while (parent && this.hasSamePositionSize(current, parent)) {
          current = parent;
          parent = current.parentElement;
        }
        return current;
      },

      getVisibleNavElements(container) {
        if (!container) return [];
        const navElements = Array.from(container.querySelectorAll("nav"));
        const visibleNavs = navElements.filter((nav) =>
          this.isElementVisible(nav)
        );
        return visibleNavs.length > 0 ? visibleNavs : [container];
      },

      findVisibleHeader() {
        const headers = Array.from(document.querySelectorAll("header"));
        const visibleHeaders = headers.filter((header) =>
          this.isElementVisible(header)
        );
        if (visibleHeaders.length === 2) {
          const headerTop = visibleHeaders.find((h) =>
            h.classList.contains("header-top")
          );
          const headerMain = visibleHeaders.find((h) =>
            h.classList.contains("header")
          );
          if (headerTop && headerMain) return headerMain;
        }
        return visibleHeaders.length > 0 ? visibleHeaders[0] : null;
      },

      getFirstVisibleNav() {
        const navs = Array.from(document.querySelectorAll("nav"));
        for (const nav of navs) {
          if (
            nav.classList.contains("panel-menu") &&
            nav.classList.contains("mobile-main-menu")
          )
            continue;
          const rect = nav.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(nav);
          const isVisible =
            computedStyle.display !== "none" &&
            computedStyle.visibility === "visible";
          const hasChildren = nav.children.length > 0;
          const hasReasonableDimensions = rect.width > 100 && rect.height > 37;
          if (isVisible && hasChildren && hasReasonableDimensions) return nav;
        }
        return null;
      },

      getElementInfo(element) {
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const classes =
          element.className && typeof element.className === "string"
            ? "." + element.className.trim().split(/\s+/).slice(0, 3).join(".")
            : "";
        return `<${tag}${id}${classes}>`;
      },
    },

    // ============================================
    // OUTLINE UTILITIES
    // ============================================
    outline: {
      show(element, color = null) {
        if (!element) return;
        const { config, state } = HoverDetector;
        element.dataset.originalOutline = element.style.outline;
        element.dataset.originalOutlineOffset = element.style.outlineOffset;
        element.style.outline = `${config.outlineWidth} solid ${
          color || config.outlineColor
        }`;
        element.style.outlineOffset = "2px";
        state.ourOutlinedElements.add(element);
      },

      hide(element) {
        if (!element) return;
        const { state } = HoverDetector;
        element.style.outline = element.dataset.originalOutline || "";
        element.style.outlineOffset =
          element.dataset.originalOutlineOffset || "";
        delete element.dataset.originalOutline;
        delete element.dataset.originalOutlineOffset;
        state.ourOutlinedElements.delete(element);
      },

      hideAll() {
        const { state } = HoverDetector;
        state.ourOutlinedElements.forEach((el) => this.hide(el));
        state.elementPath.forEach((el) => this.hide(el));
        state.menuPath.forEach((el) => this.hide(el));
        if (state.savedTargetElement) this.hide(state.savedTargetElement);
        if (state.savedMenuElement) this.hide(state.savedMenuElement);
      },
    },

    // ============================================
    // FREEZE UTILITIES
    // ============================================
    freeze: {
      eventBlocker(e) {
        e.stopPropagation();
        e.preventDefault();
      },

      savedStates: [],
      freezeIntervals: [],

      start() {
        const { state, log } = HoverDetector;
        if (state.isFrozen) return;
        state.isFrozen = true;

        const eventsToBlock = [
          "mouseout",
          "mouseleave",
          "blur",
          "focusout",
          "pointerout",
          "pointerleave",
        ];
        eventsToBlock.forEach((eventType) => {
          document.addEventListener(eventType, this.eventBlocker, true);
        });

        this.savedStates = [];
        this.freezeIntervals = [];

        if (state.savedTargetElement) {
          const allElements = state.savedTargetElement.querySelectorAll("*");

          allElements.forEach((el) => {
            if (el.getAttribute("aria-expanded") === "true") {
              const interval = setInterval(() => {
                el.setAttribute("aria-expanded", "true");
              }, 30);
              this.freezeIntervals.push(interval);
            }

            if (el.getAttribute("aria-hidden") === "false") {
              const interval = setInterval(() => {
                el.setAttribute("aria-hidden", "false");
                el.style.opacity = "1";
                el.style.visibility = "visible";
              }, 30);
              this.freezeIntervals.push(interval);
            }

            const activeClasses = [
              "active",
              "open",
              "show",
              "visible",
              "expanded",
              "is-active",
              "is-open",
              "is-expanded",
              "is-visible",
            ];
            const hasActiveClass = activeClasses.some((cls) =>
              el.classList.contains(cls)
            );

            if (hasActiveClass) {
              const classesToKeep = activeClasses.filter((cls) =>
                el.classList.contains(cls)
              );
              const interval = setInterval(() => {
                classesToKeep.forEach((cls) => el.classList.add(cls));
                el.style.opacity = "1";
                el.style.visibility = "visible";
              }, 30);
              this.freezeIntervals.push(interval);
            }

            const isMenuElement =
              el.className &&
              typeof el.className === "string" &&
              (el.className.includes("menu") ||
                el.className.includes("dropdown") ||
                el.className.includes("submenu") ||
                el.className.includes("navigation"));

            if (isMenuElement) {
              const style = window.getComputedStyle(el);
              if (style.display !== "none") {
                const interval = setInterval(() => {
                  el.style.opacity = "1";
                  el.style.visibility = "visible";
                  if (el.style.display === "none") {
                    el.style.display = "";
                  }
                }, 30);
                this.freezeIntervals.push(interval);
              }
            }
          });
        }

        log.frozen("Page frozen - Menu will stay open");
        log.muted("Complete the confirmation to unfreeze");
      },

      stop() {
        const { state, log } = HoverDetector;
        if (!state.isFrozen) return;
        state.isFrozen = false;

        const eventsToBlock = [
          "mouseout",
          "mouseleave",
          "blur",
          "focusout",
          "pointerout",
          "pointerleave",
        ];
        eventsToBlock.forEach((eventType) => {
          document.removeEventListener(eventType, this.eventBlocker, true);
        });

        this.freezeIntervals.forEach((interval) => clearInterval(interval));
        this.freezeIntervals = [];
        this.savedStates = [];

        log.success("Page unfrozen");
      },
    },

    // ============================================
    // MUTATION OBSERVER
    // ============================================
    mutation: {
      start(targetElement) {
        const { state } = HoverDetector;
        state.detectedMenuElements = [];

        state.mutationObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === "attributes") {
              const target = mutation.target;
              if (
                mutation.attributeName === "class" ||
                mutation.attributeName === "style" ||
                mutation.attributeName === "aria-expanded" ||
                mutation.attributeName === "aria-hidden" ||
                mutation.attributeName === "open"
              ) {
                const isVisible =
                  HoverDetector.utils.isElementVisible(target) ||
                  target.classList.contains("is-active") ||
                  target.classList.contains("is-open") ||
                  target.classList.contains("is-expanded") ||
                  target.classList.contains("active") ||
                  target.classList.contains("open") ||
                  target.classList.contains("show") ||
                  target.classList.contains("visible") ||
                  target.getAttribute("aria-expanded") === "true" ||
                  target.hasAttribute("open");

                if (isVisible && !state.detectedMenuElements.includes(target)) {
                  const rect = target.getBoundingClientRect();
                  if (rect.height > 50 && rect.width > 50) {
                    state.detectedMenuElements.push(target);
                  }
                }
              }
            }

            if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const rect = node.getBoundingClientRect();
                  if (rect.height > 50 && rect.width > 50) {
                    if (!state.detectedMenuElements.includes(node)) {
                      state.detectedMenuElements.push(node);
                    }
                  }
                }
              });
            }
          });
        });

        const observeTarget = state.headerElement || document.body;
        state.mutationObserver.observe(observeTarget, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeOldValue: true,
        });
      },

      stop() {
        const { state } = HoverDetector;
        if (state.mutationObserver) {
          state.mutationObserver.disconnect();
          state.mutationObserver = null;
        }
      },
    },

    // ============================================
    // HEADER DETECTION
    // ============================================
    detectHeader() {
      const { utils, log, state } = this;
      const header = utils.findVisibleHeader() || utils.getFirstVisibleNav();
      if (!header) {
        log.error("No visible header element found");
        return null;
      }
      state.headerElement = utils.findLargestContainer(header);
      state.navElement =
        utils.getVisibleNavElements(state.headerElement)[0] ||
        state.headerElement;
      log.success("Header detected");
      log.element("Header", state.headerElement);
      log.element("Nav", state.navElement);
      return state.headerElement;
    },

    isElementInHeader(element) {
      const { state } = this;
      if (!state.headerElement) return false;
      return state.headerElement.contains(element);
    },

    buildElementPath(element) {
      const { state } = this;
      const path = [];
      let current = element;

      while (
        current &&
        current !== state.navElement &&
        current !== state.headerElement
      ) {
        const hasId = current.id && current.id.trim();
        const hasClass =
          current.className &&
          typeof current.className === "string" &&
          current.className.trim();

        if (hasId || hasClass) {
          path.push(current);
        }

        current = current.parentElement;
      }

      if (path.length === 0 && element) {
        path.push(element);
      }

      return path.reverse();
    },

    // ============================================
    // TARGET ELEMENT CONFIRMATION FLOW
    // ============================================
    startConfirmation(hoveredElement) {
      const { state, log, outline, mutation } = this;
      state.isConfirming = true;
      state.elementPath = this.buildElementPath(hoveredElement);
      state.currentPathIndex = 0;

      if (state.elementPath.length === 0) {
        log.warn("No element path found");
        state.isConfirming = false;
        return;
      }
      mutation.start(state.elementPath[0]);
      this.showCurrentCandidate();
    },

    showCurrentCandidate() {
      const { state, log, outline, config, selector } = this;
      const candidate = state.elementPath[state.currentPathIndex];

      if (!candidate) {
        log.error("No more elements in path");
        this.cancelConfirmation();
        return;
      }

      state.elementPath.forEach((el) => outline.hide(el));
      outline.show(candidate, config.outlineColor);

      const candidateSelector = selector.generate(candidate);

      log.divider();
      log.prompt("Is this the TARGET element?");
      log.element("Candidate", candidate);
      console.log("Element:", candidate);
      log.divider();
      log.info(
        "Type: yes() to confirm, no() to try next element, cancel() to abort"
      );
      log.muted(
        `Element ${state.currentPathIndex + 1} of ${state.elementPath.length}`
      );

      // Notify extension
      notifyExtension({
        step: "CONFIRM_TARGET",
        title: "Is this the TARGET element?",
        message: `Selector: ${candidateSelector || "unknown"}`,
        showButtons: true,
        yesText: "Yes, this is it",
        noText: "No, try next",
        elementIndex: state.currentPathIndex + 1,
        totalElements: state.elementPath.length,
      });
    },

    confirmYes() {
      const { state, log, outline, freeze, config } = this;

      if (!state.isConfirming) {
        log.warn("No confirmation in progress");
        return;
      }

      const selectedElement = state.elementPath[state.currentPathIndex];

      state.elementPath.forEach((el) => {
        if (el !== selectedElement) outline.hide(el);
      });

      state.savedTargetElement = selectedElement;

      log.divider();
      log.success("Target element saved!");
      log.element("Saved Target", selectedElement);
      console.log("Saved Target Element:", selectedElement);

      outline.hide(selectedElement);
      outline.show(selectedElement, "#22c55e");

      log.divider();

      state.isConfirming = false;
      state.elementPath = [];
      state.currentPathIndex = 0;

      this.startMenuConfirmation();
    },

    confirmNo() {
      const { state, log } = this;
      if (!state.isConfirming) {
        log.warn("No confirmation in progress");
        return;
      }
      state.currentPathIndex++;
      if (state.currentPathIndex >= state.elementPath.length) {
        log.warn("No more elements - reached the hovered element");
        log.info("Saving the last element");
        state.currentPathIndex = state.elementPath.length - 1;
        this.confirmYes();
        return;
      }
      this.showCurrentCandidate();
    },

    cancelConfirmation() {
      const { state, log, outline, freeze, mutation } = this;

      outline.hideAll();

      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      state.elementsToKeepOpen = [];

      mutation.stop();
      freeze.stop();

      state.isConfirming = false;
      state.isConfirmingMenu = false;
      state.elementPath = [];
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();
      state.savedTargetElement = null;
      state.savedMenuElement = null;

      log.warn("Confirmation cancelled");

      // Notify extension
      notifyExtension({
        step: "CANCELLED",
        title: "Detection cancelled",
        message: "You can start over to try again.",
        showButtons: false,
        error: true,
      });
    },

    // ============================================
    // MENU ELEMENT CONFIRMATION FLOW
    // ============================================
    startMenuConfirmation() {
      const { state, log, outline, config, freeze, selector } = this;

      state.isConfirmingMenu = true;
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();

      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      // Check for <details> element
      if (state.savedTargetElement) {
        let detailsEl = null;

        if (state.savedTargetElement.tagName.toLowerCase() === "details") {
          detailsEl = state.savedTargetElement;
        } else if (state.savedTargetElement.closest("details")) {
          detailsEl = state.savedTargetElement.closest("details");
        } else if (state.savedTargetElement.querySelector("details")) {
          detailsEl = state.savedTargetElement.querySelector("details");
          outline.hide(state.savedTargetElement);
          state.savedTargetElement = detailsEl;
          outline.show(state.savedTargetElement, "#22c55e");
          log.info("Target updated to <details> element");
          log.element("New Target", detailsEl);
        }

        if (detailsEl) {
          const summary = detailsEl.querySelector("summary");
          const menuElement = summary?.nextElementSibling;

          if (menuElement) {
            state.detailsMenuElement = menuElement;
            log.divider();
            log.highlight("Detected <details> element");
            log.element("Menu will be", menuElement);
            freeze.start();

            log.divider();
            log.promptMenu("Now let's capture the MENU/POPUP element");
            log.divider();
            log.info("Please hover over the menu/popup for 2 seconds to confirm");
            log.muted("The page is frozen - the menu will stay open");
            log.divider();

            notifyExtension({
              step: "WAITING_MENU_HOVER",
              title: "Hover over the menu",
              message:
                "The page is frozen. Hover over the dropdown/popup menu for 2 seconds.",
              showButtons: false,
              waiting: true,
            });

            this.setupDetailsMenuCapture(menuElement);
            return;
          }
        }
      }

      // Regular flow for non-details elements
      freeze.start();

      log.divider();
      log.promptMenu("Now let's capture the MENU/POPUP element");
      log.divider();
      log.info("Please hover over the target element again to open the menu");
      log.muted("The page is frozen - the menu will stay open");
      log.info("Once the menu is visible, hover over it for 2 seconds");
      log.divider();

      const targetSelector = selector.generate(state.savedTargetElement);

      notifyExtension({
        step: "WAITING_MENU_HOVER",
        title: "Hover over the menu",
        message: `Target saved: ${targetSelector}\n\nNow hover over the dropdown/popup menu for 2 seconds.`,
        showButtons: false,
        waiting: true,
      });

      this.setupMenuHoverCapture();
    },

    setupDetailsMenuCapture(menuElement) {
      const { state, log, outline, config } = this;

      let menuHoverTimeout = null;
      let isHoveringMenu = false;

      const menuHoverHandler = (event) => {
        const target = event.target;
        const isOnMenu = target === menuElement || menuElement.contains(target);

        if (isOnMenu && !isHoveringMenu) {
          isHoveringMenu = true;

          if (menuHoverTimeout) clearTimeout(menuHoverTimeout);

          menuHoverTimeout = setTimeout(() => {
            document.removeEventListener("mouseover", menuHoverHandler, true);
            state.menuHoverHandler = null;

            state.menuPath = [menuElement];
            state.currentPathIndex = 0;

            log.success("Menu element confirmed!");
            this.showCurrentMenuCandidate();
          }, 2000);
        } else if (!isOnMenu && isHoveringMenu) {
          isHoveringMenu = false;
          if (menuHoverTimeout) {
            clearTimeout(menuHoverTimeout);
            menuHoverTimeout = null;
          }
        }
      };

      document.addEventListener("mouseover", menuHoverHandler, true);
      state.menuHoverHandler = menuHoverHandler;
    },

    setupMenuHoverCapture() {
      const { state, log, config, outline, mutation, utils, freeze } = this;

      state.detectedMenuElements = [];
      state.elementChangeCount = new Map();
      state.elementsToKeepOpen = [];
      mutation.stop();

      const isBecomingVisible = (element) => {
        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          computedStyle.display !== "none" &&
          computedStyle.visibility !== "hidden" &&
          rect.width > 20 &&
          rect.height > 20
        );
      };

      const hasMenuClass = (element) => {
        const classList = element.classList;
        return (
          classList.contains("sub-menu") ||
          classList.contains("submenu") ||
          classList.contains("dropdown") ||
          classList.contains("dropdown-menu") ||
          classList.contains("nav-dropdown") ||
          classList.contains("mega-menu") ||
          classList.contains("megamenu") ||
          classList.contains("menu-panel") ||
          classList.contains("x-menu--sub-new") ||
          element.className.includes("level-2") ||
          element.className.includes("submenu") ||
          element.className.includes("dropdown") ||
          element.className.includes("container") ||
          element.id?.includes("sub") ||
          element.id?.includes("menu") ||
          element.tagName.toLowerCase() === "ul"
        );
      };

      const captureOpenState = (element) => {
        const existing = state.elementsToKeepOpen.find(
          (e) => e.element === element
        );
        if (existing) return;

        const openState = {
          element: element,
          ariaExpanded: element.getAttribute("aria-expanded"),
          ariaHidden: element.getAttribute("aria-hidden"),
          classes: Array.from(element.classList),
        };

        state.elementsToKeepOpen.push(openState);
      };

      const persistMenuState = () => {
        state.elementsToKeepOpen.forEach((saved) => {
          const el = saved.element;

          if (saved.ariaExpanded === "true") {
            el.setAttribute("aria-expanded", "true");
          }

          if (saved.ariaHidden === "false") {
            el.setAttribute("aria-hidden", "false");
          }

          saved.classes.forEach((cls) => {
            if (!el.classList.contains(cls)) {
              el.classList.add(cls);
            }
          });

          el.style.opacity = "1";
          el.style.visibility = "visible";
        });
      };

      state.menuPersistInterval = setInterval(persistMenuState, 20);

      state.mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mut) => {
          const target = mut.target;

          if (state.ourOutlinedElements.has(target)) return;
          if (target === state.savedTargetElement) return;

          const isInsideTarget =
            state.savedTargetElement &&
            state.savedTargetElement.contains(target);
          if (!isInsideTarget) return;

          if (mut.type === "attributes") {
            const attrName = mut.attributeName;
            const oldValue = mut.oldValue || "";
            const newValue = target.getAttribute(attrName) || "";

            if (
              attrName === "style" &&
              newValue.includes("outline") &&
              !oldValue.includes("outline")
            ) {
              return;
            }

            if (
              attrName === "aria-hidden" &&
              oldValue === "true" &&
              newValue === "false"
            ) {
              captureOpenState(target);
            }

            if (attrName === "aria-expanded" && newValue === "true") {
              captureOpenState(target);
            }

            if (
              attrName === "class" &&
              (newValue.includes("active") ||
                newValue.includes("open") ||
                newValue.includes("show"))
            ) {
              captureOpenState(target);
            }

            let isVisibilityChange = false;

            if (attrName === "style") {
              isVisibilityChange =
                oldValue.includes("display: none") ||
                oldValue.includes("display:none") ||
                newValue.includes("display: block") ||
                newValue.includes("display:block") ||
                newValue.includes("display: flex") ||
                newValue.includes("display:flex");
            }

            if (attrName === "aria-hidden") {
              isVisibilityChange = oldValue === "true" && newValue === "false";
            }

            if (attrName === "aria-expanded") {
              isVisibilityChange = newValue === "true";
            }

            if (attrName === "class") {
              isVisibilityChange = true;
            }

            if (isVisibilityChange && isBecomingVisible(target)) {
              const currentCount = state.elementChangeCount.get(target) || 0;
              state.elementChangeCount.set(target, currentCount + 5);

              const existing = state.detectedMenuElements.find(
                (m) => m.element === target
              );
              if (existing) {
                existing.changeCount = state.elementChangeCount.get(target);
              } else {
                const rect = target.getBoundingClientRect();
                state.detectedMenuElements.push({
                  element: target,
                  reason: attrName,
                  rect: rect,
                  changeCount: state.elementChangeCount.get(target),
                  childCount: target.children.length,
                  hasMenuClass: hasMenuClass(target),
                });
              }
            }
          }

          if (mut.type === "childList" && mut.addedNodes.length > 0) {
            mut.addedNodes.forEach((node) => {
              if (
                node.nodeType === Node.ELEMENT_NODE &&
                !state.ourOutlinedElements.has(node)
              ) {
                const rect = node.getBoundingClientRect();
                if (rect.height > 20 && rect.width > 20) {
                  const existing = state.detectedMenuElements.find(
                    (m) => m.element === node
                  );
                  if (!existing) {
                    state.detectedMenuElements.push({
                      element: node,
                      reason: "added",
                      rect: rect,
                      changeCount: 10,
                      childCount: node.children.length,
                      hasMenuClass: hasMenuClass(node),
                    });
                  }
                }
              }
            });
          }
        });
      });

      const observeTarget = state.headerElement || document.body;
      state.mutationObserver.observe(observeTarget, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeOldValue: true,
      });

      let menuHoverTimeout = null;
      let lastHoveredElement = null;

      const menuHoverHandler = (event) => {
        const target = event.target;

        if (target === state.savedTargetElement) {
          return;
        }

        if (!state.headerElement?.contains(target)) return;

        if (target !== lastHoveredElement) {
          lastHoveredElement = target;
          if (menuHoverTimeout) clearTimeout(menuHoverTimeout);

          menuHoverTimeout = setTimeout(() => {
            if (state.savedTargetElement) {
              const potentialMenus = state.savedTargetElement.querySelectorAll(
                "ul, div, nav, [class*='menu'], [class*='dropdown'], [class*='submenu'], [class*='container'], [class*='level-2'], [id*='sub'], [id*='menu']"
              );

              potentialMenus.forEach((el) => {
                if (
                  el === state.savedTargetElement ||
                  state.ourOutlinedElements.has(el)
                )
                  return;

                const rect = el.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(el);

                const isVisible =
                  computedStyle.display !== "none" &&
                  computedStyle.visibility !== "hidden" &&
                  rect.width > 50 &&
                  rect.height > 20;

                if (isVisible) {
                  const existing = state.detectedMenuElements.find(
                    (m) => m.element === el
                  );
                  if (!existing) {
                    state.detectedMenuElements.push({
                      element: el,
                      reason: "scan-inside-target",
                      rect: rect,
                      changeCount: 5,
                      childCount: el.children.length,
                      hasMenuClass: hasMenuClass(el),
                    });
                  }
                }
              });
            }

            const path = [];
            let current = target;

            while (
              current &&
              current !== state.headerElement &&
              current !== state.navElement
            ) {
              if (
                current !== state.savedTargetElement &&
                !state.ourOutlinedElements.has(current)
              ) {
                path.push(current);
              }
              current = current.parentElement;
            }

            state.detectedMenuElements.forEach((detected) => {
              if (
                !path.includes(detected.element) &&
                detected.element !== state.savedTargetElement &&
                !state.ourOutlinedElements.has(detected.element)
              ) {
                path.push(detected.element);
              }
            });

            if (state.detectedMenuElements.length > 0 || path.length > 0) {
              path.sort((a, b) => {
                const detectedA = state.detectedMenuElements.find(
                  (d) => d.element === a
                );
                const detectedB = state.detectedMenuElements.find(
                  (d) => d.element === b
                );

                const scoreA = detectedA
                  ? detectedA.changeCount * 2 +
                    detectedA.childCount * 3 +
                    (detectedA.hasMenuClass ? 10 : 0)
                  : 0;
                const scoreB = detectedB
                  ? detectedB.changeCount * 2 +
                    detectedB.childCount * 3 +
                    (detectedB.hasMenuClass ? 10 : 0)
                  : 0;

                return scoreB - scoreA;
              });

              state.menuPath = path;
              state.currentPathIndex = 0;

              document.removeEventListener("mouseover", menuHoverHandler, true);

              log.success("Menu elements detected!");
              log.info(
                `Found ${state.menuPath.length} potential menu element(s)`
              );

              this.showCurrentMenuCandidate();
            }
          }, 2000);
        }
      };

      document.addEventListener("mouseover", menuHoverHandler, true);
      state.menuHoverHandler = menuHoverHandler;
    },

    showCurrentMenuCandidate() {
      const { state, log, outline, config, selector } = this;
      const candidate = state.menuPath[state.currentPathIndex];

      if (!candidate) {
        log.error("No more menu elements");
        log.info("Type: retry() to search again, or cancel() to abort");

        notifyExtension({
          step: "NO_MORE_MENUS",
          title: "No more menu elements",
          message: "Try hovering over a different area, or cancel to start over.",
          showButtons: true,
          yesText: "Retry",
          noText: "Cancel",
        });
        return;
      }

      state.menuPath.forEach((el) => outline.hide(el));

      if (state.savedTargetElement) {
        outline.show(state.savedTargetElement, "#22c55e");
      }

      outline.show(candidate, config.outlineColorMenu);

      const menuSelector = selector.generate(candidate);

      log.divider();
      log.promptMenu("Is this the MENU/POPUP element?");
      log.element("Menu Candidate", candidate);
      console.log("Menu Element:", candidate);
      log.divider();
      log.info(
        "Type: yes() to confirm, no() to try next, retry() to re-detect, cancel() to abort"
      );
      log.muted(
        `Menu ${state.currentPathIndex + 1} of ${state.menuPath.length}`
      );

      notifyExtension({
        step: "CONFIRM_MENU",
        title: "Is this the MENU element?",
        message: `Selector: ${menuSelector || "unknown"}`,
        showButtons: true,
        yesText: "Yes, this is it",
        noText: "No, try next",
        elementIndex: state.currentPathIndex + 1,
        totalElements: state.menuPath.length,
      });
    },

    confirmMenuYes() {
      const { state, log, outline, freeze, mutation, snippetGenerator, selector } =
        this;

      if (!state.isConfirmingMenu) {
        log.warn("No menu confirmation in progress");
        return;
      }

      const selectedMenu = state.menuPath[state.currentPathIndex];

      state.menuPath.forEach((el) => outline.hide(el));
      state.savedMenuElement = selectedMenu;

      log.divider();
      log.success("Menu element saved!");
      log.element("Saved Menu", selectedMenu);
      console.log("Saved Menu Element:", selectedMenu);
      log.divider();

      log.title("CAPTURE COMPLETE");
      log.divider();
      log.element("Target Element", state.savedTargetElement);
      console.log("Target:", state.savedTargetElement);
      log.element("Menu Element", state.savedMenuElement);
      console.log("Menu:", state.savedMenuElement);
      log.divider();

      outline.hide(state.savedTargetElement);
      outline.hide(selectedMenu);

      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      state.elementsToKeepOpen = [];

      log.divider();
      log.snippet("Generating test snippet...");
      log.divider();

      const snippet = snippetGenerator.generate();
      const targetSelector = selector.generate(state.savedTargetElement);
      const menuSelector = selector.generate(state.savedMenuElement);

      if (snippet) {
        console.log(
          "%c📋 COPY THE SNIPPET BELOW:",
          "color: #fff; background: #2563eb; padding: 8px 12px; border-radius: 4px; font-weight: bold; font-size: 14px;"
        );
        console.log("");
        console.log(snippet);
        console.log("");
        log.divider();
        log.info("Copy the snippet above and run it on the dashboard page");
        log.divider();
        log.muted("Generated selectors:");
        log.muted(`  Target: ${state.targetSelector}`);
        log.muted(`  Menu: ${state.menuSelector}`);
      }

      mutation.stop();
      freeze.stop();

      state.isConfirmingMenu = false;
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();

      // Notify extension with complete info
      notifyExtension({
        step: "COMPLETE",
        title: "🎉 Discovery Complete!",
        message: `Target: ${targetSelector}\nMenu: ${menuSelector}`,
        showButtons: false,
        success: true,
        code: snippet,
        targetSelector: targetSelector,
        menuSelector: menuSelector,
      });
    },

    confirmMenuNo() {
      const { state, log } = this;
      if (!state.isConfirmingMenu) {
        log.warn("No menu confirmation in progress");
        return;
      }
      state.currentPathIndex++;
      if (state.currentPathIndex >= state.menuPath.length) {
        log.warn("No more menu elements");
        log.info("Type: retry() to re-detect menus, or cancel() to abort");

        notifyExtension({
          step: "NO_MORE_MENUS",
          title: "No more menu elements",
          message:
            "Try hovering over a different area, or cancel to start over.",
          showButtons: true,
          yesText: "Retry",
          noText: "Cancel",
        });
        return;
      }
      this.showCurrentMenuCandidate();
    },

    retryMenuDetection() {
      const { state, log, outline } = this;

      state.menuPath.forEach((el) => outline.hide(el));
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();
      state.elementsToKeepOpen = [];

      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      log.divider();
      log.info("Retrying menu detection...");
      log.info("Hover over the target element to open the menu");
      log.muted("Then hover over the menu/popup for 2 seconds");
      log.divider();

      notifyExtension({
        step: "WAITING_MENU_HOVER",
        title: "Hover over the menu",
        message: "Hover over the dropdown/popup menu for 2 seconds.",
        showButtons: false,
        waiting: true,
      });

      this.setupMenuHoverCapture();
    },

    // ============================================
    // EVENT HANDLERS
    // ============================================
    handlers: {
      onMouseOver(event) {
        const target = event.target;
        const { state, config } = HoverDetector;

        if (state.isConfirming || state.isConfirmingMenu || state.isFrozen)
          return;
        if (target === state.currentElement) return;

        state.currentElement = target;
        if (state.hoverTimeout) clearTimeout(state.hoverTimeout);

        state.hoverTimeout = setTimeout(() => {
          HoverDetector.captureElement(target);
        }, config.hoverDelay);
      },

      onMouseOut(event) {
        const { state } = HoverDetector;

        if (state.isConfirming || state.isConfirmingMenu || state.isFrozen)
          return;

        if (event.target === state.currentElement) {
          if (state.hoverTimeout) {
            clearTimeout(state.hoverTimeout);
            state.hoverTimeout = null;
          }
          state.currentElement = null;
        }
      },
    },

    // ============================================
    // CAPTURE ELEMENT
    // ============================================
    captureElement(element) {
      const { log, state } = this;

      log.divider();
      log.success("Element captured after 5s hover");

      const isInHeader = this.isElementInHeader(element);

      if (isInHeader) {
        log.highlight("Element is inside header");
        log.element("Header", state.headerElement);
        console.log("Header:", state.headerElement);
        log.element("Hovered Element", element);

        this.startConfirmation(element);
      } else {
        log.warn("Element is outside header");
        log.element("Element", element);
        console.log("Element:", element);
        log.divider();

        notifyExtension({
          step: "OUTSIDE_HEADER",
          title: "Element outside header",
          message:
            "The element you hovered is not in the header/nav area. Please hover over a menu element in the header.",
          showButtons: false,
          waiting: true,
          error: true,
        });
      }

      return element;
    },

    // ============================================
    // INITIALIZE
    // ============================================
    init() {
      const { log, handlers } = this;

      console.clear();
      log.title("HEATMAP MENU DISCOVERY");
      log.muted("v2.0.0 - Chrome Extension Version");
      log.divider();

      this.detectHeader();

      log.divider();
      log.info("Hover delay: 5 seconds");
      log.success("Detector initialized and ready");
      log.muted("Hover over any header element for 5s to capture it");
      log.divider();

      document.addEventListener("mouseover", handlers.onMouseOver);
      document.addEventListener("mouseout", handlers.onMouseOut);

      window.yes = () => {
        if (this.state.isConfirmingMenu) this.confirmMenuYes();
        else this.confirmYes();
      };
      window.no = () => {
        if (this.state.isConfirmingMenu) this.confirmMenuNo();
        else this.confirmNo();
      };
      window.cancel = () => this.cancelConfirmation();
      window.retry = () => this.retryMenuDetection();

      // Notify extension that we're ready
      notifyExtension({
        step: "INIT",
        title: "Hover over a menu element",
        message:
          "Hover over a menu item in the header for 5 seconds to start detection.",
        showButtons: false,
        waiting: true,
      });
    },

    // ============================================
    // CLEANUP
    // ============================================
    destroy() {
      const { log, handlers, state, outline, freeze, mutation } = this;

      document.removeEventListener("mouseover", handlers.onMouseOver);
      document.removeEventListener("mouseout", handlers.onMouseOut);

      if (state.hoverTimeout) clearTimeout(state.hoverTimeout);

      outline.hideAll();

      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      mutation.stop();
      freeze.stop();

      state.currentElement = null;
      state.hoverTimeout = null;
      state.headerElement = null;
      state.navElement = null;
      state.savedTargetElement = null;
      state.savedMenuElement = null;
      state.isConfirming = false;
      state.isConfirmingMenu = false;
      state.isFrozen = false;
      state.elementPath = [];
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();
      state.ourOutlinedElements.clear();
      state.capturedTargetState = null;
      state.capturedMenuState = null;
      state.targetSelector = null;
      state.menuSelector = null;

      delete window.yes;
      delete window.no;
      delete window.cancel;
      delete window.retry;

      log.warn("Detector destroyed");
    },
  };

  // ============================================
  // START
  // ============================================
  HoverDetector.init();
})();
