/**
 * Browser tools for the AI Assistant.
 * Each tool: { name, description, parameters (JSON Schema), execute(args, containerRef) }
 * containerRef scopes DOM queries to the wrapped app (excludes the chat UI itself).
 */

function getContainer(containerRef) {
  return containerRef?.current || document.body
}

// ─── DOM Inspection ──────────────────────────────────────────────

const getPageStructure = {
  name: 'get_page_structure',
  description:
    'Returns an outline of the current page: headings, landmark regions, nav items, and sections. Use this to understand the overall layout.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute(_args, containerRef) {
    const root = getContainer(containerRef)

    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => ({
      level: parseInt(el.tagName[1]),
      text: el.textContent.trim().slice(0, 120),
    }))

    const landmarks = [...root.querySelectorAll('header,nav,main,aside,footer,section,article')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      childCount: el.children.length,
    }))

    return { headings, landmarks }
  },
}

const getInteractiveElements = {
  name: 'get_interactive_elements',
  description:
    'Returns all interactive elements (buttons, links, inputs, selects, textareas) with a ready-to-use `selector` for each. Use this FIRST to discover what you can interact with, then pass the returned `selector` or `testId` to click_element or fill_input.',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        enum: ['button', 'link', 'input', 'select', 'textarea'],
        description: 'Filter by element type. Omit to return all interactive elements.',
      },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    const roleMap = {
      button: 'button,[role="button"]',
      link: 'a[href]',
      input: 'input',
      select: 'select',
      textarea: 'textarea',
    }
    const selector = args.role ? roleMap[args.role] || args.role : 'button,[role="button"],a[href],input,select,textarea'

    return [...root.querySelectorAll(selector)].slice(0, 40).map((el, i) => {
      const testId = el.getAttribute('data-testid')
      const id = el.id
      // Build the most reliable selector for re-targeting this element
      const bestSelector = testId
        ? `[data-testid="${testId}"]`
        : id
          ? `#${id}`
          : null

      const label = el.labels?.[0]?.textContent?.trim()
        || el.getAttribute('aria-label')
        || el.placeholder
        || null

      const base = {
        index: i,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.value || '').trim().slice(0, 100),
        disabled: el.disabled || false,
      }

      if (bestSelector) base.selector = bestSelector
      if (testId) base.testId = testId
      if (id) base.id = id
      if (label) base.label = label
      if (el.getAttribute('aria-label')) base.ariaLabel = el.getAttribute('aria-label')
      if (el.type) base.type = el.type
      if (el.href) base.href = el.href
      if (el.name) base.name = el.name

      return base
    })
  },
}

const getElementText = {
  name: 'get_element_text',
  description:
    'Read the text content of a specific element by CSS selector or data-testid. Use selectors from get_interactive_elements or find_elements.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to find the element' },
      testId: { type: 'string', description: 'data-testid attribute value (alternative to selector)' },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    let el
    if (args.testId) {
      el = root.querySelector(`[data-testid="${args.testId}"]`)
    } else if (args.selector) {
      el = root.querySelector(args.selector)
    }
    if (!el) return { error: 'Element not found' }
    return { text: el.textContent.trim().slice(0, 2000), tag: el.tagName.toLowerCase() }
  },
}

const findElements = {
  name: 'find_elements',
  description:
    'Search for UI elements (buttons, links, headings, labels) by visible text or CSS selector. Returns matches with a ready-to-use `selector` for click_element, fill_input, or scroll_to_element. Only use this for locating UI controls — do NOT use for product searches or recommendations.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Visible text to search for (case-insensitive partial match)' },
      selector: { type: 'string', description: 'CSS selector to match elements' },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    let elements = []

    if (args.selector) {
      elements = [...root.querySelectorAll(args.selector)]
    } else if (args.text) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      const searchText = args.text.toLowerCase()
      let node
      while ((node = walker.nextNode())) {
        if (node.textContent?.toLowerCase().includes(searchText)) {
          const directText = [...node.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join('')
          if (directText.toLowerCase().includes(searchText)) {
            elements.push(node)
          }
        }
      }
    }

    return elements.slice(0, 10).map((el) => {
      const testId = el.getAttribute('data-testid')
      const id = el.id
      const tag = el.tagName.toLowerCase()
      // Build the best selector for this element
      const bestSelector = testId
        ? `[data-testid="${testId}"]`
        : id
          ? `#${id}`
          : null

      const result = {
        tag,
        text: el.textContent.trim().slice(0, 120),
        isInteractive: ['button', 'a', 'input', 'select', 'textarea'].includes(tag) || el.getAttribute('role') === 'button',
      }
      if (bestSelector) result.selector = bestSelector
      if (testId) result.testId = testId
      if (id) result.id = id

      return result
    })
  },
}

const getFormState = {
  name: 'get_form_state',
  description:
    'Returns all form inputs, selects, and textareas with their current values, names, and labels.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute(_args, containerRef) {
    const root = getContainer(containerRef)
    return [...root.querySelectorAll('input,select,textarea')].map((el) => {
      const label = el.labels?.[0]?.textContent?.trim() || el.getAttribute('aria-label') || el.placeholder || null
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        value: el.type === 'password' ? '***' : (el.value || ''),
        checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
        label,
      }
    })
  },
}

const getAccessibilityTree = {
  name: 'get_accessibility_tree',
  description:
    'Returns a simplified accessibility tree: elements with ARIA roles, labels, and states. Useful for understanding the semantic structure.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute(_args, containerRef) {
    const root = getContainer(containerRef)
    const implicit = {
      HEADER: 'banner', NAV: 'navigation', MAIN: 'main', FOOTER: 'contentinfo',
      ASIDE: 'complementary', BUTTON: 'button', A: 'link', SELECT: 'listbox',
      OPTION: 'option', H1: 'heading', H2: 'heading', H3: 'heading',
      H4: 'heading', H5: 'heading', H6: 'heading',
    }

    const results = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node
    while ((node = walker.nextNode())) {
      const role = node.getAttribute('role') || implicit[node.tagName] || null
      if (!role) continue
      results.push({
        role,
        name: node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 60) || null,
        tag: node.tagName.toLowerCase(),
        disabled: node.disabled || node.getAttribute('aria-disabled') === 'true' || false,
        expanded: node.getAttribute('aria-expanded') || null,
        selected: node.getAttribute('aria-selected') || null,
        level: role === 'heading' ? parseInt(node.tagName[1]) : undefined,
      })
      if (results.length >= 10) break
    }
    return results
  },
}

// ─── DOM Interaction ─────────────────────────────────────────────

const clickElement = {
  name: 'click_element',
  description:
    'Click an element on the page. Preferred: pass `selector` or `testId` from a previous get_interactive_elements or find_elements call. Fallback: pass `text` to search by visible label (searches buttons, links, tabs, list items, and any clickable element). If clicking by text fails, use get_interactive_elements first to find the right selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector (best option — use value from get_interactive_elements or find_elements)' },
      testId: { type: 'string', description: 'data-testid attribute value' },
      text: { type: 'string', description: 'Visible text label of the element to click (case-insensitive partial match)' },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    let el

    if (args.testId) {
      el = root.querySelector(`[data-testid="${args.testId}"]`)
    } else if (args.selector) {
      el = root.querySelector(args.selector)
    } else if (args.text) {
      const searchText = args.text.toLowerCase()
      // Search broadly: buttons, links, tabs, list items, labeled spans/divs, any role=button
      const candidates = [...root.querySelectorAll('button, a, [role="button"], [role="tab"], input[type="submit"], input[type="button"], li, label, [onclick], [tabindex]')]
      // Prefer exact match, fall back to partial match
      el = candidates.find((c) => c.textContent.trim().toLowerCase() === searchText)
        || candidates.find((c) => c.textContent.trim().toLowerCase().includes(searchText))
      // If still not found, search ALL elements as a last resort
      if (!el) {
        const allEls = [...root.querySelectorAll('*')]
        el = allEls.find((c) => {
          const directText = [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim().toLowerCase()
          return directText === searchText || directText.includes(searchText)
        })
      }
    }

    if (!el) return { success: false, error: 'Element not found. Try get_interactive_elements to discover available elements and their selectors.' }
    if (el.disabled) return { success: false, error: 'Element is disabled' }

    el.click()
    return { success: true, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 80) }
  },
}

const fillInput = {
  name: 'fill_input',
  description:
    'Set the value of an input, textarea, or select. Identify the field by `selector`, `testId`, or `label` (matches the visible label text, placeholder, or aria-label). Triggers React-compatible change events.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the input (best option — use value from get_interactive_elements)' },
      testId: { type: 'string', description: 'data-testid attribute value' },
      label: { type: 'string', description: 'Visible label text, placeholder, or aria-label of the input (case-insensitive)' },
      value: { type: 'string', description: 'Value to set' },
    },
    required: ['value'],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    let el
    if (args.testId) {
      el = root.querySelector(`[data-testid="${args.testId}"]`)
    } else if (args.selector) {
      el = root.querySelector(args.selector)
    } else if (args.label) {
      const searchLabel = args.label.toLowerCase()
      // Try matching by associated <label>, aria-label, or placeholder
      const inputs = [...root.querySelectorAll('input,select,textarea')]
      el = inputs.find((inp) => {
        const labelText = inp.labels?.[0]?.textContent?.trim().toLowerCase() || ''
        const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase()
        const placeholder = (inp.placeholder || '').toLowerCase()
        const name = (inp.name || '').toLowerCase()
        return labelText.includes(searchLabel) || ariaLabel.includes(searchLabel) || placeholder.includes(searchLabel) || name === searchLabel
      })
    }
    if (!el) return { success: false, error: 'Element not found. Try get_interactive_elements to discover available inputs and their selectors.' }

    // React-compatible value setting
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, args.value)
    } else {
      el.value = args.value
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))

    return { success: true, tag: el.tagName.toLowerCase(), newValue: args.value }
  },
}

const scrollToElement = {
  name: 'scroll_to_element',
  description: 'Scroll a specific element into view.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      testId: { type: 'string', description: 'data-testid value' },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = getContainer(containerRef)
    let el
    if (args.testId) el = root.querySelector(`[data-testid="${args.testId}"]`)
    else if (args.selector) el = root.querySelector(args.selector)
    if (!el) return { success: false, error: 'Element not found' }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return { success: true }
  },
}

// ─── Navigation ──────────────────────────────────────────────────

const getCurrentRoute = {
  name: 'get_current_route',
  description: 'Returns the current URL, pathname, query parameters, and hash.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const url = new URL(window.location.href)
    return {
      href: url.href,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      params: Object.fromEntries(url.searchParams),
    }
  },
}

const navigateTo = {
  name: 'navigate_to',
  description: 'Navigate the browser to a given path or URL within the app.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path or URL to navigate to' },
    },
    required: ['path'],
  },
  execute(args) {
    if (args.path.startsWith('http')) {
      window.location.href = args.path
    } else {
      window.history.pushState({}, '', args.path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    return { success: true, navigatedTo: args.path }
  },
}

// ─── Page State ──────────────────────────────────────────────────

const getPageTitle = {
  name: 'get_page_title',
  description: 'Returns the document title.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    return { title: document.title }
  },
}

const getVisibleText = {
  name: 'get_visible_text',
  description:
    'Returns all visible text content on the page (truncated to 3000 chars). Use sparingly — prefer targeted tools.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute(_args, containerRef) {
    const root = getContainer(containerRef)
    const text = root.innerText || root.textContent || ''
    return { text: text.trim().slice(0, 3000), truncated: text.length > 3000 }
  },
}

const getMetaInfo = {
  name: 'get_meta_info',
  description: 'Returns document meta tags: description, keywords, viewport, og tags.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const metas = [...document.querySelectorAll('meta[name],meta[property]')]
    return metas.reduce((acc, m) => {
      const key = m.getAttribute('name') || m.getAttribute('property')
      acc[key] = m.getAttribute('content')
      return acc
    }, {})
  },
}

// ─── Browser APIs ────────────────────────────────────────────────

const getViewportInfo = {
  name: 'get_viewport_info',
  description: 'Returns window dimensions, scroll position, and device pixel ratio.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    }
  },
}

const getLocalStorage = {
  name: 'get_local_storage',
  description: 'Returns all localStorage key-value pairs (values truncated to 200 chars each).',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const data = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      data[key] = (localStorage.getItem(key) || '').slice(0, 200)
    }
    return data
  },
}

const getSessionStorage = {
  name: 'get_session_storage',
  description: 'Returns all sessionStorage key-value pairs.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const data = {}
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      data[key] = (sessionStorage.getItem(key) || '').slice(0, 200)
    }
    return data
  },
}

const getCookies = {
  name: 'get_cookies',
  description: 'Returns parsed document cookies.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    if (!document.cookie) return {}
    return document.cookie.split(';').reduce((acc, c) => {
      const [key, ...val] = c.trim().split('=')
      acc[key] = val.join('=')
      return acc
    }, {})
  },
}

const getPerformanceMetrics = {
  name: 'get_performance_metrics',
  description: 'Returns page performance metrics: load timing, resource count, memory usage if available.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const result = {
      resourceCount: resources.length,
      totalTransferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
    }
    if (nav) {
      result.domContentLoaded = Math.round(nav.domContentLoadedEventEnd)
      result.loadComplete = Math.round(nav.loadEventEnd)
      result.domInteractive = Math.round(nav.domInteractive)
    }
    if (performance.memory) {
      result.jsHeapSize = performance.memory.usedJSHeapSize
      result.jsHeapLimit = performance.memory.jsHeapSizeLimit
    }
    return result
  },
}

const getNetworkInfo = {
  name: 'get_network_info',
  description: 'Returns network connection info if available (connection type, downlink speed, etc).',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    if (!conn) return { available: false }
    return {
      available: true,
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
      saveData: conn.saveData,
    }
  },
}

const getMediaQueries = {
  name: 'get_media_queries',
  description: 'Checks common media queries and returns which ones currently match.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    const queries = {
      mobile: '(max-width: 640px)',
      tablet: '(min-width: 641px) and (max-width: 1024px)',
      desktop: '(min-width: 1025px)',
      darkMode: '(prefers-color-scheme: dark)',
      lightMode: '(prefers-color-scheme: light)',
      reducedMotion: '(prefers-reduced-motion: reduce)',
      portrait: '(orientation: portrait)',
      landscape: '(orientation: landscape)',
      highContrast: '(prefers-contrast: high)',
      touchDevice: '(pointer: coarse)',
    }
    return Object.fromEntries(
      Object.entries(queries).map(([name, q]) => [name, window.matchMedia(q).matches])
    )
  },
}

// ─── Pointer ─────────────────────────────────────────────────────

const pointToElement = {
  name: 'point_to_element',
  description:
    'Visually highlight an element on the page with an animated pointer overlay. If the element is off-screen, a directional arrow is shown indicating which way to scroll. Use this to guide the user\'s attention to a specific part of the UI. The pointer auto-dismisses after a few seconds.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the element to point at' },
      testId: { type: 'string', description: 'data-testid value of the element' },
      text: { type: 'string', description: 'Visible text to search for (matches buttons, links, headings)' },
      label: { type: 'string', description: 'Optional label to display above the pointer' },
    },
    required: [],
  },
  execute(args, containerRef) {
    const root = containerRef?.current || document.body
    let el

    if (args.testId) {
      el = root.querySelector(`[data-testid="${args.testId}"]`)
    } else if (args.selector) {
      el = root.querySelector(args.selector)
    } else if (args.text) {
      const searchText = args.text.toLowerCase()
      const candidates = [...root.querySelectorAll('button,a,[role="button"],[role="tab"],h1,h2,h3,h4,h5,h6,label,span,p,li,td,th,dt,dd')]
      el = candidates.find((c) => c.textContent.trim().toLowerCase() === searchText)
        || candidates.find((c) => c.textContent.trim().toLowerCase().includes(searchText))
    }

    if (!el) return { success: false, error: 'Element not found' }

    // Dispatch pointer event — picked up by PointerOverlay via window event
    window.dispatchEvent(
      new CustomEvent('ai-assistant:point', {
        detail: { element: el, label: args.label || null },
      })
    )

    const rect = el.getBoundingClientRect()
    const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth

    return {
      success: true,
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 80),
      onScreen,
      hint: onScreen ? 'Pointer is highlighting the element' : 'Element is off-screen — arrow is showing scroll direction',
    }
  },
}

const dismissPointerTool = {
  name: 'dismiss_pointer',
  description: 'Dismiss the currently visible pointer overlay if one is showing.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute() {
    window.dispatchEvent(new CustomEvent('ai-assistant:dismiss-pointer'))
    return { success: true }
  },
}

// ─── Export all tools ────────────────────────────────────────────

export const defaultTools = [
  // DOM Inspection
  getPageStructure,
 
  getAccessibilityTree,
  // DOM Interaction
  clickElement,
  fillInput,
  scrollToElement,
  // Navigation
  getCurrentRoute,
  navigateTo,
  // Page State
  getPageTitle,
  getVisibleText,
  // Pointer
  pointToElement,
  dismissPointerTool,
]

/**
 * Convert tools array to OpenAI Responses API format.
 */
export function toolsToOpenAIFunctions(tools) {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}
