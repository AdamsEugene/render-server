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

  const utils = {
    isElementVisible(el) {
      if (!el) return false;
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 10 && r.height > 30 && r.height < 300;
    },
    hasSamePositionSize(e1, e2) {
      const r1 = e1.getBoundingClientRect(), r2 = e2.getBoundingClientRect();
      return Math.abs(r1.top - r2.top) < 1 && Math.abs(r1.right - r2.right) < 1 && Math.abs(r1.bottom - r2.bottom) < 1 && Math.abs(r1.left - r2.left) < 1;
    },
    findVisibleHeader(dom) {
      const headers = Array.from(dom.querySelectorAll("header"));
      return headers.filter(h => this.isElementVisible(h))[0] || null;
    },
    findLargestContainer(el) {
      let c = el, p = c.parentElement;
      while (p && this.hasSamePositionSize(c, p)) { c = p; p = c.parentElement; }
      return c;
    },
    drawOutline(el, color = "#8b5cf6") {
      if (el) { el.style.outline = "3px solid " + color; el.style.outlineOffset = "2px"; }
    },
    clearOutline(el) {
      if (el) { el.style.outline = ""; el.style.outlineOffset = ""; }
    }
  };

  const iframe = document.getElementById("recordingPlayer1");
  if (!iframe) { console.error("❌ Could not find iframe 'recordingPlayer1'"); return; }

  const dom = iframe.contentWindow?.document || iframe.contentDocument;
  if (!dom) { console.error("❌ Could not access iframe document"); return; }

  console.log("%c🎯 Menu Test Snippet", "color: #fff; background: #8b5cf6; padding: 8px 12px; border-radius: 4px; font-weight: bold;");

  let header = utils.findVisibleHeader(dom);
  if (header) { header = utils.findLargestContainer(header); console.log("✓ Found header:", header); }
  const searchRoot = header || dom.body;

  let targetEl = searchRoot.querySelector(config.targetSelector) || dom.querySelector(config.targetSelector);
  if (!targetEl) { console.error("❌ Target not found:", config.targetSelector); return; }
  console.log("✓ Found target:", targetEl);
  utils.drawOutline(targetEl, "#8b5cf6");

  let menuEl = searchRoot.querySelector(config.menuSelector) || dom.querySelector(config.menuSelector);
  if (!menuEl) { console.error("❌ Menu not found:", config.menuSelector); return; }
  console.log("✓ Found menu:", menuEl);

  config.targetClasses.forEach(c => c && targetEl.classList.add(c));
  Object.entries(config.targetAttrs).forEach(([k, v]) => {
    if (k === "open" && v) { targetEl.setAttribute("open", ""); if (targetEl.tagName.toLowerCase() === "details") targetEl.open = true; }
    else if (v !== null) targetEl.setAttribute(k, v);
  });
  Object.entries(config.targetStyles).forEach(([p, v]) => targetEl.style.setProperty(p, v, "important"));

  const rect = targetEl.getBoundingClientRect();
  ["mouseenter", "mouseover", "mousemove", "focus"].forEach(type => {
    targetEl.dispatchEvent(new MouseEvent(type, { view: iframe.contentWindow, bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
  });

  config.menuClasses.forEach(c => c && menuEl.classList.add(c));
  Object.entries(config.menuAttrs).forEach(([k, v]) => v !== null && menuEl.setAttribute(k, v));
  Object.entries(config.menuStyles).forEach(([p, v]) => menuEl.style.setProperty(p, v, "important"));

  if (config.targetIsDetails) { targetEl.setAttribute("open", ""); targetEl.open = true; }

  utils.drawOutline(menuEl, "#10b981");

  console.log("%c✓ Hover state applied!", "color: #10b981; font-weight: bold;");
  console.log("%c❓ Does this look correct?", "color: #fff; background: #f59e0b; padding: 6px 10px; border-radius: 4px; font-weight: bold;");
  console.log("Type: snippetOk() to confirm, snippetNo() to clear");

  window._snippetTest = { targetEl, menuEl, config, utils,
    cleanup() {
      utils.clearOutline(targetEl); utils.clearOutline(menuEl);
      config.targetClasses.forEach(c => c && targetEl.classList.remove(c));
      config.menuClasses.forEach(c => c && menuEl.classList.remove(c));
      Object.keys(config.targetStyles).forEach(p => targetEl.style.removeProperty(p));
      Object.keys(config.menuStyles).forEach(p => menuEl.style.removeProperty(p));
      console.log("✓ Cleaned up");
    }
  };

  window.snippetOk = () => {
    console.log("%c✓ Configuration confirmed!", "color: #10b981; font-weight: bold;");
    console.log("");
    console.log("%c📋 SPECIFICS.TS CODE INFO:", "color: #fff; background: #059669; padding: 8px 12px; border-radius: 4px; font-weight: bold; font-size: 14px;");
    console.log("");
    
    const targetClasses = Array.from(targetEl.classList).filter(c => 
      !/^(is-|has-|active|open|show|visible|expanded|hover|focus|selected|current)/.test(c) &&
      !/(active|open|visible|expanded)$/.test(c)
    );
    
    const menuClasses = Array.from(menuEl.classList).filter(c => 
      !/^(is-|has-|active|open|show|visible|expanded|hover|focus|selected|current)/.test(c) &&
      !/(active|open|visible|expanded)$/.test(c)
    );
    
    const info = {
      targetClassCheck: targetClasses[0] || targetClasses.join(".") || "NEEDS_CLASS",
      menuSelector: "." + menuClasses.join(".") || "NEEDS_SELECTOR",
      stylesToApply: config.menuStyles,
      stylesToRemove: Object.keys(config.menuStyles),
    };
    
    console.log("%c// Target element class to check:", "color: #8b5cf6; font-weight: bold;");
    console.log(\`element.classList.contains("\${info.targetClassCheck}")\`);
    console.log("");
    
    console.log("%c// Menu selector for getMenuContent:", "color: #8b5cf6; font-weight: bold;");
    console.log(\`this.getMenuContent(element, "\${info.menuSelector}")\`);
    console.log("");
    
    console.log("%c// Styles to apply (for handle function):", "color: #8b5cf6; font-weight: bold;");
    console.log("this.setStyle(menuContent, " + JSON.stringify(info.stylesToApply, null, 2) + ");");
    console.log("");
    
    console.log("%c// Styles to remove (for clear function):", "color: #8b5cf6; font-weight: bold;");
    console.log(\`this.removeStyle(menuContent, \${JSON.stringify(info.stylesToRemove)});\`);
    console.log("");
    
    console.log("%c// ===== SAMPLE SPECIFICS.TS CODE =====", "color: #fff; background: #7c3aed; padding: 6px 10px; border-radius: 4px; font-weight: bold;");
    console.log("");
    
    const funcName = "handleYOUR_SITE_NAMEMenu";
    const sampleCode = \`
  public \${funcName}(element: HTMLElement): void {
    if (element.classList.contains("\${info.targetClassCheck}")) {
      const menuContent = this.getMenuContent(
        element,
        "\${info.menuSelector}"
      );
      if (menuContent) {
        this.setStyle(menuContent, \${JSON.stringify(info.stylesToApply, null, 8).replace(/\\n/g, "\\n        ")});
      }
    }
  }

  public \${funcName}clear(element: HTMLElement): void {
    if (element.classList.contains("\${info.targetClassCheck}")) {
      const menuContent = this.getMenuContent(
        element,
        "\${info.menuSelector}"
      );
      if (menuContent) {
        this.removeStyle(menuContent, \${JSON.stringify(info.stylesToRemove)});
      }
    }
  }
\`;
    console.log(sampleCode);
    
    console.log("%c// ===== RAW DATA =====", "color: #6b7280; font-weight: bold;");
    console.log({
      target: { element: targetEl, allClasses: Array.from(targetEl.classList), meaningfulClasses: targetClasses, id: targetEl.id || null },
      menu: { element: menuEl, allClasses: Array.from(menuEl.classList), meaningfulClasses: menuClasses, id: menuEl.id || null },
      styles: config.menuStyles,
      attrs: config.menuAttrs,
    });
    
    window._snippetTest?.cleanup();
  };
  
  window.snippetNo = () => { console.log("○ Clearing..."); window._snippetTest?.cleanup(); };
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

      // Store original states to restore later
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

        // Find and persist menu states inside the target element
        if (state.savedTargetElement) {
          // Get all elements inside target that might need persisting
          const allElements = state.savedTargetElement.querySelectorAll("*");

          allElements.forEach((el) => {
            // Persist aria-expanded="true"
            if (el.getAttribute("aria-expanded") === "true") {
              const interval = setInterval(() => {
                el.setAttribute("aria-expanded", "true");
              }, 30);
              this.freezeIntervals.push(interval);
            }

            // Persist aria-hidden="false"
            if (el.getAttribute("aria-hidden") === "false") {
              const interval = setInterval(() => {
                el.setAttribute("aria-hidden", "false");
                el.style.opacity = "1";
                el.style.visibility = "visible";
              }, 30);
              this.freezeIntervals.push(interval);
            }

            // Persist active/open/show classes and styles
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

            // Persist any visible menu/dropdown elements
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

        // Clear all freeze intervals
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

            if (
              mutation.type === "childList" &&
              mutation.addedNodes.length > 0
            ) {
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
        // Only add elements that have an id or class
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

      // If no elements with id/class found, fallback to original element
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

      // Handle OUTSIDE_HEADER confirmation
      if (state.pendingElement && !state.isConfirming) {
        const element = state.pendingElement;
        state.pendingElement = null;

        // Set up a fallback header if needed
        if (!state.headerElement) {
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            const rect = parent.getBoundingClientRect();
            if (rect.height < 400 && rect.width > 200) {
              state.headerElement = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }

        this.startConfirmation(element);
        return;
      }

      if (!state.isConfirming) {
        log.warn("No confirmation in progress");
        return;
      }

      const selectedElement = state.elementPath[state.currentPathIndex];

      // Hide other candidates but keep selected one
      state.elementPath.forEach((el) => {
        if (el !== selectedElement) outline.hide(el);
      });

      state.savedTargetElement = selectedElement;

      log.divider();
      log.success("Target element saved!");
      log.element("Saved Target", selectedElement);
      console.log("Saved Target Element:", selectedElement);

      // Change outline to green for confirmed target
      outline.hide(selectedElement);
      outline.show(selectedElement, "#22c55e");

      log.divider();

      state.isConfirming = false;
      state.elementPath = [];
      state.currentPathIndex = 0;

      // Don't freeze here - let startMenuConfirmation handle it
      // (details elements don't need freezing)
      this.startMenuConfirmation();
    },

    confirmNo() {
      const { state, log } = this;

      // Handle OUTSIDE_HEADER rejection - just clear and go back to init
      if (state.pendingElement && !state.isConfirming) {
        state.pendingElement = null;
        log.info("Rejected element - continue hovering to find another");

        // Notify extension to go back to init state
        notifyExtension({
          step: "INIT",
          title: "Hover over a menu element",
          message:
            "Hover over a menu item in the header for 5 seconds to start detection.",
          showButtons: false,
          waiting: true,
        });
        return;
      }

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

      // Clear menu persist interval
      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      // Clear elements to keep open
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
      const { state, log, outline, config, freeze } = this;

      state.isConfirmingMenu = true;
      state.menuPath = [];
      state.currentPathIndex = 0;
      state.detectedMenuElements = [];
      state.elementChangeCount.clear();

      // Clean up any existing hover handler
      if (state.menuHoverHandler) {
        document.removeEventListener("mouseover", state.menuHoverHandler, true);
        state.menuHoverHandler = null;
      }

      // Check for <details> element - either the target itself, parent, or child
      if (state.savedTargetElement) {
        let detailsEl = null;

        // Check if target IS a details
        if (state.savedTargetElement.tagName.toLowerCase() === "details") {
          detailsEl = state.savedTargetElement;
        }
        // Check if target is inside a details
        else if (state.savedTargetElement.closest("details")) {
          detailsEl = state.savedTargetElement.closest("details");
        }
        // Check if target contains a details
        else if (state.savedTargetElement.querySelector("details")) {
          detailsEl = state.savedTargetElement.querySelector("details");

          // Update the target to be the details element
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
            // Store the menu element for details
            state.detailsMenuElement = menuElement;

            log.divider();
            log.highlight("Detected <details> element");
            log.element("Menu will be", menuElement);

            // Still freeze and require hover like regular flow
            freeze.start();

            log.divider();
            log.promptMenu("Now let's capture the MENU/POPUP element");
            log.divider();
            log.info(
              "Please hover over the menu/popup for 2 seconds to confirm"
            );
            log.muted("The page is frozen - the menu will stay open");
            log.divider();

            // Notify extension
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

      const targetSelector = this.selector.generate(state.savedTargetElement);

      // Notify extension
      notifyExtension({
        step: "WAITING_MENU_HOVER",
        title: "Hover over the menu",
        message: `Target saved: ${targetSelector}\n\nNow hover over the dropdown/popup menu for 2 seconds.`,
        showButtons: false,
        waiting: true,
      });

      this.setupMenuHoverCapture();
    },

    // Special hover capture for details elements - we know the menu, just need user to hover on it
    setupDetailsMenuCapture(menuElement) {
      const { state, log, outline, config } = this;

      let menuHoverTimeout = null;
      let isHoveringMenu = false;

      const menuHoverHandler = (event) => {
        const target = event.target;

        // Check if hovering on the menu element or inside it
        const isOnMenu = target === menuElement || menuElement.contains(target);

        if (isOnMenu && !isHoveringMenu) {
          isHoveringMenu = true;

          if (menuHoverTimeout) clearTimeout(menuHoverTimeout);

          menuHoverTimeout = setTimeout(() => {
            // User hovered on menu for 2 seconds
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
      state.elementsToKeepOpen = []; // Store elements and their open state
      mutation.stop();

      // Helper to check if element just became visible
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

      // Helper to check for menu-related classes
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

      // Capture element's open state
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

      // Persist all captured open states
      const persistMenuState = () => {
        state.elementsToKeepOpen.forEach((saved) => {
          const el = saved.element;

          // Restore aria-expanded
          if (saved.ariaExpanded === "true") {
            el.setAttribute("aria-expanded", "true");
          }

          // Restore aria-hidden and force visible
          if (saved.ariaHidden === "false") {
            el.setAttribute("aria-hidden", "false");
          }

          // Restore classes (especially 'active')
          saved.classes.forEach((cls) => {
            if (!el.classList.contains(cls)) {
              el.classList.add(cls);
            }
          });

          // Always force visibility
          el.style.opacity = "1";
          el.style.visibility = "visible";
        });
      };

      // Start interval to continuously persist menu state
      state.menuPersistInterval = setInterval(persistMenuState, 20);

      state.mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mut) => {
          const target = mut.target;

          if (state.ourOutlinedElements.has(target)) return;
          if (target === state.savedTargetElement) return;

          // Check if element is inside the target element OR is a descendant
          const isInsideTarget =
            state.savedTargetElement &&
            state.savedTargetElement.contains(target);
          if (!isInsideTarget) return;

          if (mut.type === "attributes") {
            const attrName = mut.attributeName;
            const oldValue = mut.oldValue || "";
            const newValue = target.getAttribute(attrName) || "";

            // Skip our outline changes
            if (
              attrName === "style" &&
              newValue.includes("outline") &&
              !oldValue.includes("outline")
            ) {
              return;
            }

            // Detect when element becomes visible/active - capture its state!
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

            // Detect visibility changes
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

        // Skip if hovering on the target element itself (but not its children)
        if (target === state.savedTargetElement) {
          return;
        }

        if (!state.headerElement?.contains(target)) return;

        if (target !== lastHoveredElement) {
          lastHoveredElement = target;
          if (menuHoverTimeout) clearTimeout(menuHoverTimeout);

          menuHoverTimeout = setTimeout(() => {
            // Scan inside target element for visible potential menus
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
              // Sort by score: (changeCount * 2) + (childCount * 3) + (hasMenuClass ? 10 : 0)
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

        // Notify extension
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

      state.menuPath.forEach((el) => outline.hide(el));

      // Keep target element outlined in green
      if (state.savedTargetElement) {
        outline.show(state.savedTargetElement, "#22c55e");
      }

      // Show menu candidate in green (menu color)
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

      // Notify extension
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
      const { state, log, outline, freeze, mutation, snippetGenerator } = this;

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

      // Clear menu persist interval
      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      // Clear elements to keep open
      state.elementsToKeepOpen = [];

      // Generate snippet
      log.divider();
      log.snippet("Generating test snippet...");
      log.divider();

      const snippet = snippetGenerator.generate();

      const targetSelector = this.selector.generate(state.savedTargetElement);
      const menuSelector = this.selector.generate(state.savedMenuElement);

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
        log.info(
          "It will test the hover state in the iframe (recordingPlayer1)"
        );
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

        // Notify extension
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

      // Clear menu persist interval
      if (state.menuPersistInterval) {
        clearInterval(state.menuPersistInterval);
        state.menuPersistInterval = null;
      }

      log.divider();
      log.info("Retrying menu detection...");
      log.info("Hover over the target element to open the menu");
      log.muted("Then hover over the menu/popup for 2 seconds");
      log.divider();

      // Notify extension
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
      countdownOverlay: null,
      countdownInterval: null,
      hoverStartTime: null,

      createCountdownOverlay() {
        if (this.countdownOverlay) return this.countdownOverlay;

        const overlay = document.createElement("div");
        overlay.id = "heatmap-hover-countdown";
        overlay.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: linear-gradient(135deg, #00C48C 0%, #14B8A6 100%);
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 600;
          z-index: 2147483647;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          display: none;
          pointer-events: none;
        `;
        document.body.appendChild(overlay);
        this.countdownOverlay = overlay;
        return overlay;
      },

      showCountdown(seconds) {
        const overlay = this.createCountdownOverlay();
        overlay.textContent = `🎯 Hold for ${seconds}s...`;
        overlay.style.display = "block";
      },

      hideCountdown() {
        if (this.countdownOverlay) {
          this.countdownOverlay.style.display = "none";
        }
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
      },

      onMouseOver(event) {
        const target = event.target;
        const { state, config, outline } = HoverDetector;
        const handlers = HoverDetector.handlers;

        if (state.isConfirming || state.isConfirmingMenu || state.isFrozen)
          return;

        // Ignore body, html, and very small elements
        if (target === document.body || target === document.documentElement)
          return;

        const rect = target.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;

        // If already tracking this element or a child of it, keep the timer
        if (state.currentElement) {
          if (
            state.currentElement === target ||
            state.currentElement.contains(target)
          ) {
            return;
          }
          // Check if target is a parent of current element (moving up)
          if (target.contains(state.currentElement)) {
            return;
          }
        }

        // Clear previous tracking
        if (state.hoverTimeout) {
          clearTimeout(state.hoverTimeout);
          handlers.hideCountdown();
          if (state.currentElement) {
            outline.hide(state.currentElement);
          }
        }

        state.currentElement = target;
        handlers.hoverStartTime = Date.now();

        // Show visual feedback
        outline.show(target, "#00C48C");

        // Start countdown display
        let remainingSeconds = Math.ceil(config.hoverDelay / 1000);
        handlers.showCountdown(remainingSeconds);

        handlers.countdownInterval = setInterval(() => {
          const elapsed = Date.now() - handlers.hoverStartTime;
          remainingSeconds = Math.ceil((config.hoverDelay - elapsed) / 1000);
          if (remainingSeconds > 0) {
            handlers.showCountdown(remainingSeconds);
          }
        }, 200);

        state.hoverTimeout = setTimeout(() => {
          handlers.hideCountdown();
          outline.hide(target);
          HoverDetector.captureElement(target);
        }, config.hoverDelay);
      },

      onMouseOut(event) {
        const { state, outline } = HoverDetector;
        const handlers = HoverDetector.handlers;

        if (state.isConfirming || state.isConfirmingMenu || state.isFrozen)
          return;

        // Check if we're moving to a child element - if so, keep the timer
        const relatedTarget = event.relatedTarget;
        if (
          relatedTarget &&
          state.currentElement &&
          (state.currentElement.contains(relatedTarget) ||
            relatedTarget === state.currentElement)
        ) {
          return;
        }

        // Check if we're moving to a parent - if so, keep the timer
        if (
          relatedTarget &&
          state.currentElement &&
          relatedTarget.contains(state.currentElement)
        ) {
          return;
        }

        // Actually leaving the element
        if (state.hoverTimeout) {
          clearTimeout(state.hoverTimeout);
          state.hoverTimeout = null;
        }
        handlers.hideCountdown();
        if (state.currentElement) {
          outline.hide(state.currentElement);
        }
        state.currentElement = null;
      },
    },

    // ============================================
    // CAPTURE ELEMENT
    // ============================================
    captureElement(element) {
      const { log, state, selector } = this;

      log.divider();
      log.success("Element captured after 5s hover");

      const isInHeader = this.isElementInHeader(element);

      if (isInHeader) {
        log.highlight("Element is inside header");
        log.element("Header", state.headerElement);
        console.log("Header:", state.headerElement);
        log.element("Hovered Element", element);

        this.startConfirmation(element);
      } else if (!state.headerElement) {
        // No header detected, allow capturing anyway
        log.warn("No header detected - capturing element anyway");
        log.element("Element", element);
        console.log("Element:", element);

        // Use the element's parent as a fallback "header"
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const rect = parent.getBoundingClientRect();
          if (rect.height < 400 && rect.width > 200) {
            state.headerElement = parent;
            break;
          }
          parent = parent.parentElement;
        }

        this.startConfirmation(element);
      } else {
        const elementSelector = selector.generate(element);
        log.warn("Element is outside detected header");
        log.element("Element", element);
        log.info(`Selector: ${elementSelector}`);
        console.log("Element:", element);
        log.divider();

        // Store the element for potential use
        state.pendingElement = element;

        // Notify extension
        notifyExtension({
          step: "OUTSIDE_HEADER",
          title: "Element outside header - continue?",
          message: `This element is not in the detected header area.\n\nSelector: ${elementSelector}\n\nDo you want to use it anyway?`,
          showButtons: true,
          yesText: "Yes, use it",
          noText: "No, try again",
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
