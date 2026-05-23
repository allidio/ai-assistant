# AI Assistant — React Component Library

**Embeddable AI chat widget for any React application.** The AI Assistant is a production-ready React component that adds intelligent, conversational capabilities to your web app.

## Features

- 🧠 **Multi-turn AI conversations** — Up to 10 rounds of agentic reasoning per message
- 🎯 **11 Built-in Browser Tools** — DOM inspection, interaction, navigation, visual guidance
- 🔌 **Custom Tool API** — Extend with domain-specific actions via `extraTools` prop
- 📍 **Visual Pointer Overlay** — Animated highlights and directional arrows guide users
- 🎨 **Scoped DOM Access** — All queries scoped to app content via `containerRef` (no self-interaction)
- 🚀 **Easy Integration** — Wrap your app in 3 lines, get a ready-to-use chat assistant
- ⚙️ **Framework Agnostic Backend** — Works with any backend that supports the `/api/ai/responses` protocol

## Quick Start

```bash
npm install ai-assistant
```

### Basic Integration

```jsx
import { AiAssistant } from 'ai-assistant';

function App() {
  return (
    <AiAssistant 
      agentKey="your_agent_key_here"
      proxyUrl="https://your-backend.com/api/ai"
    >
      <YourApplication />
    </AiAssistant>
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `agentKey` | `string` | Yes | Authentication key provided by AI backend |
| `proxyUrl` | `string` | No | Backend URL (default: `http://localhost:3456/api/ai`) |
| `children` | `ReactNode` | Yes | Your application content |
| `extraTools` | `Tool[]` | No | Custom tools to merge with built-in 11 tools |
| `workflows` | `Workflow[]` | No | Multi-step guided flows |

## Built-in Tools (11 Tools)

The assistant comes with **11 built-in browser tools**:

### DOM Inspection (7 tools)
- `get_page_structure` — Full DOM tree with semantic hierarchy
- `get_interactive_elements` — Buttons, links, inputs, forms
- `get_element_text` — Text content of specific elements
- `find_elements` — Search by text, aria-label, or CSS selector
- `get_form_state` — Current form values and validation state
- `get_accessibility_tree` — Full accessibility tree (ARIA labels, roles)
- `get_visible_text` — All visible text on the page

### DOM Actions (3 tools)
- `click_element` — Click any clickable element
- `fill_input` — Type into input fields
- `scroll_to_element` — Scroll element into view

### Navigation (2 tools)
- `get_current_route` — Read current URL / route
- `navigate_to` — Change route or navigate to URL

### Visual Guidance (2 tools)
- `point_to_element` — Highlight element with animated pointer
- `dismiss_pointer` — Remove pointer overlay

## Custom Tools

Extend the assistant with domain-specific tools:

```jsx
const customTools = [
  {
    name: 'add_to_cart',
    description: 'CART ACTION — Add a product to the shopping cart by SKU ID.',
    parameters: {
      type: 'object',
      properties: {
        sku_id: { type: 'string', description: 'Product SKU' },
        quantity: { type: 'number', description: 'Quantity to add' },
      },
      required: ['sku_id'],
    },
    async execute(args) {
      try {
        const result = await addToCart(args.sku_id, args.quantity || 1);
        window.dispatchEvent(new CustomEvent('cart:updated'));
        return result;
      } catch (err) {
        return { error: err.message };
      }
    },
  },
];

<AiAssistant extraTools={customTools}>
  <App />
</AiAssistant>
```

### Tool Best Practices

1. **Name convention** — Use `snake_case`, verb-noun pattern (e.g., `add_to_cart`, `get_orders`)
2. **Description prefix** — Start with category: `CART ACTION —`, `ORDER ACTION —`
3. **Error handling** — Always wrap in try/catch, return `{ error: "message" }`
4. **Event dispatch** — Emit custom events for UI-mutating actions
5. **Concise results** — Keep JSON payloads small; format values for the LLM
6. **No DOM manipulation** — Use built-in tools for clicking/scrolling; only dispatch events

## Workflows

Define multi-step guided flows for complex user journeys:

```jsx
const checkoutWorkflow = {
  id: 'checkout',
  name: 'Checkout Assistant',
  description: 'User wants to proceed to checkout or complete their purchase.',
  startNode: 'validate_cart',
  nodes: {
    validate_cart: {
      type: 'tool',
      toolName: 'get_cart',
      next: 'check_empty',
    },
    check_empty: {
      type: 'condition',
      evaluate(context) {
        return context.validate_cart.items.length === 0 ? 'empty' : 'has_items';
      },
      branches: { empty: 'empty_msg', has_items: 'collect_address' },
    },
    empty_msg: {
      type: 'llm',
      prompt: 'Tell the user their cart is empty.',
      next: null,
    },
    collect_address: {
      type: 'llm',
      prompt: 'Ask for shipping address.',
      next: 'process_payment',
    },
    process_payment: {
      type: 'tool',
      toolName: 'process_payment',
      next: 'confirm',
    },
    confirm: {
      type: 'llm',
      prompt: 'Confirm order and show order number.',
      next: null,
    },
  },
};

<AiAssistant workflows={[checkoutWorkflow]}>
  <App />
</AiAssistant>
```

## API Protocol

The component communicates with your backend via:

```
POST /api/ai/responses
Headers: { "x-agent-key": "your_agent_key" }
Body: {
  "input": "user message",
  "tools": [...tool definitions...],
  "previous_response_id": "resp_xyz"  // for multi-turn
}
```

**Response format:**
```json
{
  "id": "resp_abc",
  "content": [
    {
      "type": "function_call",
      "name": "get_page_structure",
      "id": "call_123"
    }
  ]
}
// or
{
  "id": "resp_abc",
  "content": [
    {
      "type": "text",
      "text": "I found the button you requested..."
    }
  ]
}
```

## Architecture

```
┌─────────────────────────────────┐
│  Your React App                 │
│  ┌─────────────────────────┐    │
│  │ <AiAssistant>           │    │
│  │  ├─ Chat Panel          │    │
│  │  ├─ FAB Button          │    │
│  │  └─ Pointer Overlay     │    │
│  │                         │    │
│  │  containerRef (scoped)  │    │
│  └─────────────────────────┘    │
└──────────────────┬──────────────┘
                   │
         POST /api/ai/responses
         (with agent_key header)
                   │
                   ▼
       ┌──────────────────────┐
       │  AI Backend          │
       │                      │
       │  • Agent validation  │
       │  • RAG augmentation  │
       │  • OpenAI proxy      │
       │  • Usage tracking    │
       └──────────────────────┘
```

## Examples

### E-Commerce Integration (Sephora Demo)

See [Screen Pilot Shop](https://github.com/allidio/screen-pilot) for a complete e-commerce example with:
- Product search workflow
- Shopping cart management
- Order tracking
- Returns processing

### Chat with Custom Tools

```jsx
import { AiAssistant } from 'ai-assistant';
import { cartTools } from './cartTools.js';
import { orderTools } from './orderTools.js';

<AiAssistant 
  agentKey="agent_abc123"
  extraTools={[...cartTools, ...orderTools]}
>
  <Shop />
</AiAssistant>
```

## Security

- ✅ **API key server-side only** — Frontend never has access to OpenAI keys
- ✅ **Tool execution client-side** — All tools run in the browser, never on backend
- ✅ **Scoped DOM access** — Via `containerRef`, prevents self-interaction
- ✅ **No prompt injection** — System prompts enforced server-side
- ✅ **Agent key per agent** — Validate and authenticate via x-agent-key header

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

MIT — See LICENSE file

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m "Add feature"`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## Support

- 📖 **Documentation** — [Presentation](https://github.com/allidio/screen-pilot/blob/main/PRESENTATION.md)
- 🐛 **Issues** — Report bugs [here](https://github.com/allidio/ai-assistant/issues)
- 💬 **Discussions** — Ask questions [here](https://github.com/allidio/ai-assistant/discussions)

---

**Screen Pilot** — Give your web application an AI that can see, understand, and act.
