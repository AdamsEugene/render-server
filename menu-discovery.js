(function () {
  "use strict";

  // State management
  const state = {
    step: "INIT",
    menuButton: null,
    menuButtonSelector: null,
    menuElement: null,
    menuElementSelector: null,
    closedSnapshot: null,
    openSnapshot: null,
    mutations: [],
    observer: null,
    clickListener: null,
    mutationObserver: null,
    observedMutations: [],
  };

  // Console styling
  const styles = {
    title: "color: #00C48C; font-size: 16px; font-weight: bold;",
    divider: "color: #00C48C;",
    success: "color: #00C48C; font-weight: bold;",
    info: "color: #14B8A6; font-weight: bold;",
    warning: "color: #f59e0b; font-weight: bold;",
    error: "color: #ef4444; font-weight: bold;",
    code: "background: #1e293b; color: #e2e8f0; padding: 2px 6px; border-radius: 3px;",
  };

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

  // Utility: Log with style
  function log(message, style = "") {
    if (style) {
      console.log(`%c${message}`, style);
    } else {
      console.log(message);
    }
  }

  // Utility: Generate optimal selector for an element
  function generateSelector(element) {
    if (
      !element ||
      element === document ||
      element === document.documentElement
    ) {
      return null;
    }

    // Try ID first (most reliable)
    if (element.id && /^[a-zA-Z][\w-]*$/.test(element.id)) {
      const selector = `#${CSS.escape(element.id)}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }

    // Try unique data attributes
    const dataAttrs = Array.from(element.attributes).filter(
      (attr) => attr.name.startsWith("data-") && attr.value
    );

    for (const attr of dataAttrs) {
      const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (e) {
        continue;
      }
    }

    // Try unique class combination
    if (element.className && typeof element.className === "string") {
      const classes = element.className
        .trim()
        .split(/\s+/)
        .filter((c) => c && /^[a-zA-Z_-]/.test(c));
      if (classes.length > 0) {
        // Try single classes first
        for (const cls of classes) {
          const selector = `.${CSS.escape(cls)}`;
          try {
            if (document.querySelectorAll(selector).length === 1) {
              return selector;
            }
          } catch (e) {
            continue;
          }
        }
        // Try class combinations
        if (classes.length > 1) {
          const selector = "." + classes.map((c) => CSS.escape(c)).join(".");
          try {
            if (document.querySelectorAll(selector).length === 1) {
              return selector;
            }
          } catch (e) {
            // Continue to next method
          }
        }
      }
    }

    // Try aria-label
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      const selector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (e) {
        // Continue
      }
    }

    // Generate CSS path as fallback
    return generateCSSPath(element);
  }

  // Generate a CSS path for element
  function generateCSSPath(element) {
    const path = [];
    let current = element;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      let selector = current.tagName.toLowerCase();

      // Add ID if present
      if (current.id && /^[a-zA-Z][\w-]*$/.test(current.id)) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }

      // Add classes if helpful
      if (current.className && typeof current.className === "string") {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && /^[a-zA-Z_-]/.test(c))
          .slice(0, 2); // Limit to 2 classes
        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }

      // Add nth-child for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const sameTagSiblings = siblings.filter(
          (el) => el.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  // Utility: Capture element snapshot (computed styles and geometry)
  function captureSnapshot(element) {
    if (!element) return null;

    const computed = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return {
      // Visibility properties
      opacity: computed.opacity,
      display: computed.display,
      visibility: computed.visibility,

      // Positioning
      zIndex: computed.zIndex,
      position: computed.position,
      left: computed.left,
      top: computed.top,
      right: computed.right,
      bottom: computed.bottom,

      // Transforms
      transform: computed.transform,

      // Dimensions
      width: computed.width,
      height: computed.height,
      maxHeight: computed.maxHeight,

      // Overflow
      overflow: computed.overflow,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,

      // Geometry
      rectWidth: rect.width,
      rectHeight: rect.height,
      rectX: rect.x,
      rectY: rect.y,

      // Classes and inline styles
      className: element.className || "",
      inlineStyles: element.style.cssText || "",

      // ARIA attributes
      ariaHidden: element.getAttribute("aria-hidden"),
      ariaExpanded: element.getAttribute("aria-expanded"),
    };
  }

  // Find potential menu elements near the button
  function findMenuElement(button) {
    const candidates = [];

    // Check common menu selectors first
    const commonSelectors = [
      'nav:not([role="main"])',
      '[role="navigation"]',
      ".mobile-menu",
      ".mobile-nav",
      ".nav-menu",
      ".menu-container",
      ".navigation-menu",
      "#mobile-menu",
      "#nav-menu",
      ".menu",
      ".nav",
      ".navigation",
      "#menu",
      "#navigation",
    ];

    for (const sel of commonSelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => {
          if (
            !candidates.includes(el) &&
            el !== button &&
            !el.contains(button)
          ) {
            candidates.push(el);
          }
        });
      } catch (e) {
        continue;
      }
    }

    // Check siblings of button's parent
    let parent = button.parentElement;
    while (parent && parent !== document.body) {
      const siblings = Array.from(parent.children);
      siblings.forEach((sibling) => {
        if (
          sibling !== button &&
          !sibling.contains(button) &&
          !candidates.includes(sibling)
        ) {
          const tag = sibling.tagName.toLowerCase();
          if (["nav", "ul", "div"].includes(tag)) {
            candidates.push(sibling);
          }
        }
      });
      parent = parent.parentElement;
    }

    // Check for elements that might be menus (larger containers)
    parent = button.parentElement;
    while (parent && parent !== document.body) {
      if (!candidates.includes(parent)) {
        candidates.push(parent);
      }
      parent = parent.parentElement;
    }

    // Score and sort candidates
    const scoredCandidates = candidates.map((el) => {
      let score = 0;
      const tag = el.tagName.toLowerCase();
      const classes = (el.className || "").toLowerCase();
      const id = (el.id || "").toLowerCase();

      // Prefer nav elements
      if (tag === "nav") score += 10;
      if (el.getAttribute("role") === "navigation") score += 10;

      // Prefer elements with menu-related names
      if (classes.includes("menu") || id.includes("menu")) score += 8;
      if (classes.includes("nav") || id.includes("nav")) score += 7;
      if (classes.includes("mobile")) score += 5;

      // Check for links inside
      const links = el.querySelectorAll("a");
      if (links.length > 2) score += links.length;

      // Check size
      const rect = el.getBoundingClientRect();
      if (rect.height > 100 && rect.width > 100) score += 3;

      return { element: el, score };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates.length > 0
      ? scoredCandidates[0].element
      : button.parentElement;
  }

  // Compare snapshots and detect mutations
  function detectMutations(closedSnap, openSnap, element) {
    if (!closedSnap || !openSnap) return [];

    const mutations = [];
    const selector = generateSelector(element);

    if (!selector) return [];

    // CSS properties to check
    const styleProperties = [
      "opacity",
      "display",
      "visibility",
      "zIndex",
      "transform",
      "left",
      "top",
      "right",
      "bottom",
      "position",
      "width",
      "height",
      "maxHeight",
      "overflow",
      "overflowX",
      "overflowY",
    ];

    styleProperties.forEach((prop) => {
      if (closedSnap[prop] !== openSnap[prop]) {
        mutations.push({
          selector: selector,
          property: prop,
          closedValue: closedSnap[prop],
          openValue: openSnap[prop],
          type: "style",
        });
      }
    });

    // Check for class changes
    const closedClassName = String(closedSnap.className || "");
    const openClassName = String(openSnap.className || "");

    if (closedClassName !== openClassName) {
      const closedClasses = closedClassName.split(/\s+/).filter((c) => c);
      const openClasses = openClassName.split(/\s+/).filter((c) => c);

      const addedClasses = openClasses.filter(
        (c) => !closedClasses.includes(c)
      );
      const removedClasses = closedClasses.filter(
        (c) => !openClasses.includes(c)
      );

      if (addedClasses.length > 0 || removedClasses.length > 0) {
        mutations.push({
          selector: selector,
          property: "className",
          closedValue: closedClassName,
          openValue: openClassName,
          addedClasses: addedClasses,
          removedClasses: removedClasses,
          type: "class",
        });
      }
    }

    // Check ARIA attributes
    if (closedSnap.ariaHidden !== openSnap.ariaHidden) {
      mutations.push({
        selector: selector,
        property: "aria-hidden",
        closedValue: closedSnap.ariaHidden,
        openValue: openSnap.ariaHidden,
        type: "attribute",
      });
    }

    if (closedSnap.ariaExpanded !== openSnap.ariaExpanded) {
      mutations.push({
        selector: selector,
        property: "aria-expanded",
        closedValue: closedSnap.ariaExpanded,
        openValue: openSnap.ariaExpanded,
        type: "attribute",
      });
    }

    return mutations;
  }

  // Generate the final fix code
  function generateFixCode() {
    const timestamp = new Date().toISOString();
    const mutationsJson = JSON.stringify(state.mutations, null, 2);

    const code = `// Site-specific menu fix
// Generated: ${timestamp}
// Button: ${state.menuButtonSelector}
// Menu: ${state.menuElementSelector}

(function() {
  'use strict';
  
  const menuButtonSelector = '${state.menuButtonSelector}';
  const menuElementSelector = '${state.menuElementSelector}';
  
  const mutations = ${mutationsJson};
  
  function applyMenuState(isOpen) {
    mutations.forEach(function(mut) {
      const el = document.querySelector(mut.selector);
      if (!el) return;
      
      if (mut.type === 'class') {
        // Handle class changes
        if (isOpen) {
          mut.addedClasses.forEach(function(cls) { 
            if (cls) el.classList.add(cls); 
          });
          mut.removedClasses.forEach(function(cls) { 
            if (cls) el.classList.remove(cls); 
          });
        } else {
          mut.addedClasses.forEach(function(cls) { 
            if (cls) el.classList.remove(cls); 
          });
          mut.removedClasses.forEach(function(cls) { 
            if (cls) el.classList.add(cls); 
          });
        }
      } else if (mut.type === 'attribute') {
        // Handle attribute changes
        const value = isOpen ? mut.openValue : mut.closedValue;
        if (value === null) {
          el.removeAttribute(mut.property);
        } else {
          el.setAttribute(mut.property, value);
        }
      } else {
        // Handle style changes
        const value = isOpen ? mut.openValue : mut.closedValue;
        el.style[mut.property] = value;
      }
    });
  }
  
  function initMenuFix() {
    const button = document.querySelector(menuButtonSelector);
    if (!button) {
      console.warn('[MenuFix] Button not found:', menuButtonSelector);
      return;
    }
    
    let isOpen = false;
    
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      applyMenuState(isOpen);
    });
    
    console.log('[MenuFix] Initialized successfully');
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenuFix);
  } else {
    initMenuFix();
  }
})();`;

    return code;
  }

  // Setup MutationObserver to track DOM changes
  function setupMutationObserver() {
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    state.observedMutations = [];

    state.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        state.observedMutations.push({
          type: mutation.type,
          target: mutation.target,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
          timestamp: Date.now(),
        });
      });
    });

    // Observe the menu element and its subtree
    if (state.menuElement) {
      state.mutationObserver.observe(state.menuElement, {
        attributes: true,
        attributeOldValue: true,
        childList: true,
        subtree: true,
      });
    }

    // Also observe body for any menu-related changes
    state.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
      subtree: false,
    });
  }

  // Step handlers
  const steps = {
    INIT: function () {
      log("🔧 Menu Discovery Script v2.0", styles.title);
      log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        styles.divider
      );
      log("");
      log("📋 Instructions:");
      log("   1. Click on the menu button (hamburger icon)");
      log("   2. Follow the prompts in the console");
      log("   3. Respond with: window.yes() or window.no()");
      log("");
      log("⏳ Waiting for menu button click...", styles.info);

      // Notify extension
      notifyExtension({
        step: "INIT",
        title: "Click on the menu button",
        message:
          "Click on the hamburger menu or menu button you want to detect",
        showButtons: false,
        waiting: true,
      });

      // Remove any existing listener
      if (state.clickListener) {
        document.removeEventListener("click", state.clickListener, true);
      }

      state.clickListener = function (e) {
        // Ignore clicks on the document itself
        if (e.target === document || e.target === document.documentElement) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        state.menuButton = e.target;
        state.menuButtonSelector = generateSelector(e.target);

        log("");
        log("✓ Click detected!", styles.success);
        log(`   Selector: ${state.menuButtonSelector}`);
        log("   Element:", state.menuButton);
        log("");
        log("❓ Is this the menu button?", styles.warning);
        log("   → Type: window.yes() or window.no()");

        // Notify extension
        notifyExtension({
          step: "CONFIRM_BUTTON",
          title: "Is this the menu button?",
          message: `Detected: ${state.menuButtonSelector}`,
          showButtons: true,
          yesText: "Yes, this is it",
          noText: "No, try again",
        });

        state.step = "CONFIRM_BUTTON";
        document.removeEventListener("click", state.clickListener, true);
      };

      document.addEventListener("click", state.clickListener, true);
    },

    CONFIRM_BUTTON: function (confirmed) {
      if (!confirmed) {
        log("");
        log("🔄 Let's try again. Click on the menu button...", styles.info);
        state.menuButton = null;
        state.menuButtonSelector = null;
        state.step = "INIT";

        notifyExtension({
          step: "INIT",
          title: "Click on the menu button",
          message: "Try clicking on the correct menu button",
          showButtons: false,
          waiting: true,
        });

        document.addEventListener("click", state.clickListener, true);
        return;
      }

      log("");
      log("✓ Button confirmed!", styles.success);
      log("");

      // Find the menu element
      state.menuElement = findMenuElement(state.menuButton);
      state.menuElementSelector = generateSelector(state.menuElement);

      log("📍 Detected menu element:");
      log(`   Selector: ${state.menuElementSelector}`);
      log("   Element:", state.menuElement);
      log("");

      // Capture closed state snapshot
      state.closedSnapshot = captureSnapshot(state.menuElement);

      // Setup mutation observer
      setupMutationObserver();

      log("🔄 Now clicking the button to open the menu...", styles.info);

      notifyExtension({
        step: "OPENING_MENU",
        title: "Opening menu...",
        message: "Clicking the button to open the menu",
        showButtons: false,
        waiting: true,
      });

      // Programmatically click the button after a delay
      setTimeout(() => {
        // Create and dispatch a real click event
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        state.menuButton.dispatchEvent(clickEvent);

        setTimeout(() => {
          log("");
          log("❓ Did the menu just open?", styles.warning);
          log("   → Type: window.yes() or window.no()");

          notifyExtension({
            step: "CONFIRM_OPENED",
            title: "Did the menu open?",
            message: "Check if the menu is now visible on the page",
            showButtons: true,
            yesText: "Yes, it opened",
            noText: "No, it didn't",
          });

          state.step = "CONFIRM_OPENED";
        }, 500);
      }, 300);
    },

    CONFIRM_OPENED: function (confirmed) {
      if (!confirmed) {
        log("");
        log("⚠️ Menu didn't open properly", styles.error);
        log("   Possible reasons:");
        log("   • The detected menu element is incorrect");
        log("   • The menu requires specific interactions");
        log("   • The menu is lazy-loaded");
        log("");
        log("   Would you like to try selecting a different menu element?");
        log("   → Type: window.yes() to restart, window.no() to abort");

        notifyExtension({
          step: "RETRY_OR_ABORT",
          title: "Menu didn't open",
          message: "Would you like to try again?",
          showButtons: true,
          yesText: "Try again",
          noText: "Cancel",
        });

        state.step = "RETRY_OR_ABORT";
        return;
      }

      log("");
      log("✓ Menu opened successfully!", styles.success);
      log("");
      log("📸 Capturing open state...", styles.info);

      // Capture open state
      state.openSnapshot = captureSnapshot(state.menuElement);

      // Stop mutation observer
      if (state.mutationObserver) {
        state.mutationObserver.disconnect();
      }

      // Detect mutations by comparing snapshots
      state.mutations = detectMutations(
        state.closedSnapshot,
        state.openSnapshot,
        state.menuElement
      );

      log("");
      if (state.mutations.length === 0) {
        log("⚠️ No mutations detected!", styles.warning);
        log("   The menu might use CSS transitions or animations.");
        log("   Attempting to detect class-based changes...");

        // Force class-based mutation if we can detect it
        const closedClasses = String(state.closedSnapshot.className || "")
          .split(/\s+/)
          .filter((c) => c);
        const openClasses = String(state.openSnapshot.className || "")
          .split(/\s+/)
          .filter((c) => c);

        if (closedClasses.join(" ") !== openClasses.join(" ")) {
          state.mutations.push({
            selector: state.menuElementSelector,
            property: "className",
            closedValue: state.closedSnapshot.className,
            openValue: state.openSnapshot.className,
            addedClasses: openClasses.filter((c) => !closedClasses.includes(c)),
            removedClasses: closedClasses.filter(
              (c) => !openClasses.includes(c)
            ),
            type: "class",
          });
        }
      }

      log(`🔍 Detected ${state.mutations.length} mutation(s):`);
      state.mutations.forEach((mut, i) => {
        if (mut.type === "class") {
          log(
            `   ${i + 1}. Classes: +[${mut.addedClasses.join(
              ", "
            )}] -[${mut.removedClasses.join(", ")}]`
          );
        } else {
          log(
            `   ${i + 1}. ${mut.property}: "${mut.closedValue}" → "${
              mut.openValue
            }"`
          );
        }
      });
      log("");

      if (state.mutations.length === 0) {
        log("⚠️ Could not detect menu state changes.", styles.error);
        log("   This site may require a custom solution.");

        notifyExtension({
          step: "COMPLETE",
          title: "No changes detected",
          message:
            "Could not detect menu state changes. This site may need a custom solution.",
          showButtons: false,
          error: true,
        });

        state.step = "COMPLETE";
        return;
      }

      notifyExtension({
        step: "TESTING",
        title: "Testing menu toggle...",
        message: `Detected ${state.mutations.length} change(s). Testing...`,
        showButtons: false,
        waiting: true,
      });

      log("🔄 Testing by toggling the menu...", styles.info);

      // Test toggling
      let toggleCount = 0;
      const maxToggles = 4;

      const testInterval = setInterval(() => {
        if (toggleCount >= maxToggles) {
          clearInterval(testInterval);
          log("");
          log("❓ Is the menu currently OPEN?", styles.warning);
          log("   → Type: window.yes() or window.no()");

          notifyExtension({
            step: "CONFIRM_FINAL_STATE",
            title: "Is the menu currently open?",
            message: "After testing, check if the menu is open or closed",
            showButtons: true,
            yesText: "Yes, it's open",
            noText: "No, it's closed",
          });

          state.step = "CONFIRM_FINAL_STATE";
          return;
        }

        // Toggle by clicking button
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        state.menuButton.dispatchEvent(clickEvent);
        toggleCount++;
        log(`   Toggle ${toggleCount}/${maxToggles}...`);
      }, 800);
    },

    RETRY_OR_ABORT: function (retry) {
      if (retry) {
        log("");
        log("🔄 Restarting discovery process...", styles.info);
        state.menuButton = null;
        state.menuButtonSelector = null;
        state.menuElement = null;
        state.menuElementSelector = null;
        state.closedSnapshot = null;
        state.openSnapshot = null;
        state.mutations = [];
        state.step = "INIT";
        steps.INIT();
      } else {
        log("");
        log("❌ Discovery aborted.", styles.error);
        log("   This site may require manual menu fix implementation.");

        notifyExtension({
          step: "COMPLETE",
          title: "Discovery cancelled",
          message: "You can try again or implement a custom solution.",
          showButtons: false,
          error: true,
        });

        state.step = "COMPLETE";
      }
    },

    CONFIRM_FINAL_STATE: function (isOpen) {
      log("");
      log("✓ Test complete!", styles.success);
      log("");
      log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        styles.divider
      );
      log("🎉 Generated Menu Fix Code", styles.title);
      log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        styles.divider
      );
      log("");

      const fixCode = generateFixCode();
      console.log(fixCode);

      log("");
      log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        styles.divider
      );
      log("");
      log("📋 Next steps:");
      log("   1. Copy the code above");
      log("   2. Save as: /menu-fixes/[site_id].js");
      log("   3. Upload to S3");
      log("   4. Enable in site settings");
      log("");
      log("✨ Discovery complete!", styles.success);

      // Store in global for easy access
      window.menuFixCode = fixCode;
      window.menuDiscoveryState = state;

      log("");
      log("💡 Tip: Code is available as window.menuFixCode");

      notifyExtension({
        step: "COMPLETE",
        title: "🎉 Discovery complete!",
        message: `Button: ${state.menuButtonSelector}\nMenu: ${state.menuElementSelector}\n\nCode copied to console.`,
        showButtons: false,
        success: true,
        code: fixCode,
      });

      state.step = "COMPLETE";
    },
  };

  // Global yes/no functions
  window.yes = function () {
    if (state.step === "COMPLETE") {
      log("Discovery already complete!", styles.info);
      return;
    }
    if (state.step === "INIT") {
      log("Please click the menu button first!", styles.warning);
      return;
    }
    if (steps[state.step]) {
      steps[state.step](true);
    }
  };

  window.no = function () {
    if (state.step === "COMPLETE") {
      log("Discovery already complete!", styles.info);
      return;
    }
    if (state.step === "INIT") {
      log("Please click the menu button first!", styles.warning);
      return;
    }
    if (steps[state.step]) {
      steps[state.step](false);
    }
  };

  // Restart function
  window.restartDiscovery = function () {
    log("");
    log("🔄 Restarting Menu Discovery...", styles.info);

    // Clean up
    if (state.clickListener) {
      document.removeEventListener("click", state.clickListener, true);
    }
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    // Reset state
    state.step = "INIT";
    state.menuButton = null;
    state.menuButtonSelector = null;
    state.menuElement = null;
    state.menuElementSelector = null;
    state.closedSnapshot = null;
    state.openSnapshot = null;
    state.mutations = [];
    state.observedMutations = [];

    // Start fresh
    steps.INIT();
  };

  // Start the process
  try {
    steps.INIT();
  } catch (error) {
    console.error("[MenuDiscovery] Initialization failed:", error);
    notifyExtension({
      step: "ERROR",
      title: "Error",
      message: error.message,
      showButtons: false,
      error: true,
    });
  }
})();
