/**
 * Lightweight client-side workflow engine that guides an LLM
 * through step-by-step flows defined as node graphs.
 *
 * Pure ES module, no dependencies.
 */

/**
 * Resolve a dot-path like "search.sku_ids" against an object.
 */
function resolvePath(obj, path) {
  if (!path || !obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Replace template placeholders in a prompt string.
 *   {{userMessage}}           → state.userMessage
 *   {{context.nodeId.field}}  → state.context[nodeId][field]
 */
function resolveTemplate(template, state) {
  return template.replace(/\{\{(.+?)\}\}/g, (_match, key) => {
    const trimmed = key.trim();
    if (trimmed === 'userMessage') {
      return state.userMessage ?? '';
    }
    if (trimmed.startsWith('context.')) {
      const contextPath = trimmed.slice('context.'.length);
      const value = resolvePath(state.context, contextPath);
      if (value == null) return '';
      return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    }
    return '';
  });
}

/**
 * Build a classification prompt that asks the LLM to pick a workflow (or none)
 * AND which RAG pipelines to use for the default flow.
 *
 * @param {string} userMessage
 * @param {Array} workflows — each must have `id` and `description`
 * @param {Array} ragPipelines — each must have `name` and `description`
 * @returns {string|null} prompt string
 */
export function buildClassificationPrompt(userMessage, workflows, ragPipelines = []) {
  if (!userMessage) return null;
  if ((!workflows || workflows.length === 0) && ragPipelines.length === 0) return null;

  let prompt = `You are a routing classifier. Given the user's message, decide two things:

1. Which workflow (if any) should handle it.
2. Which knowledge bases (if any) are relevant for answering.\n\n`;

  if (workflows && workflows.length > 0) {
    const workflowList = workflows
      .map((w) => `- "${w.id}": ${w.description}`)
      .join('\n');
    prompt += `Available workflows:\n${workflowList}\n- "none": The message doesn't match any workflow — handle it with the default assistant.\n\n`;
  } else {
    prompt += `No workflows are available. Always set workflow to "none".\n\n`;
  }

  if (ragPipelines.length > 0) {
    const ragList = ragPipelines
      .map((r) => `- "${r.name}": ${r.description}`)
      .join('\n');
    prompt += `Available knowledge bases:\n${ragList}\n\n`;
    prompt += `If workflow is "none", select which knowledge bases (if any) are relevant to the user's message. If a workflow is selected, set rag to an empty array (the workflow handles its own RAG).\n\n`;
  }

  prompt += `User message: "${userMessage}"

Respond with ONLY a JSON object like:
{"workflow": "workflow_id", "rag": ["kb_name_1"]}

Use "none" for workflow if no workflow fits. Use an empty array [] for rag if no knowledge bases are relevant.`;

  return prompt;
}

/**
 * Given the LLM's classification response text, return:
 *   { workflow: WorkflowDef|null, rag: string[]|true }
 */
export function resolveClassification(responseText, workflows, ragPipelines = []) {
  const fallback = { workflow: null, rag: true };
  if (!responseText) return fallback;

  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) return fallback;

  try {
    const parsed = JSON.parse(match[0]);

    // Resolve workflow
    const workflowId = parsed.workflow;
    const workflow = (workflowId && workflowId !== 'none' && workflows)
      ? workflows.find((w) => w.id === workflowId) || null
      : null;

    // Resolve RAG selection
    let rag = true; // default: search all
    if (Array.isArray(parsed.rag)) {
      if (parsed.rag.length === 0) {
        rag = false;
      } else if (ragPipelines.length > 0) {
        // Validate names against known pipelines
        const validNames = new Set(ragPipelines.map((r) => r.name));
        const selected = parsed.rag.filter((name) => validNames.has(name));
        rag = selected.length > 0 ? selected : false;
      } else {
        rag = parsed.rag;
      }
    }

    return { workflow, rag };
  } catch {
    return fallback;
  }
}

/**
 * Create initial workflow state from a workflow definition and user message.
 */
export function createWorkflowState(workflow, userMessage) {
  return {
    workflow,
    userMessage,
    currentNodeId: workflow.startNode,
    context: {},
    history: [],
    status: 'running',
  };
}

/**
 * Given the current workflow state, return an action object describing
 * what the caller should do next.
 */
export function getNextAction(state) {
  const node = state.workflow.nodes?.[state.currentNodeId];

  if (!node) {
    return { type: 'done' };
  }

  switch (node.type) {
    case 'llm': {
      const prompt = resolveTemplate(node.prompt, state);
      return {
        type: 'llm',
        prompt,
        rag: node.rag ?? false,
      };
    }

    case 'tool': {
      const args = {};
      if (node.argMapping) {
        for (const [param, path] of Object.entries(node.argMapping)) {
          args[param] = resolvePath(state.context, path);
        }
      }
      return {
        type: 'tool',
        toolName: node.toolName,
        args,
      };
    }

    case 'condition': {
      if (typeof node.evaluate === 'function') {
        const key = node.evaluate(state.context);
        const nextNodeId = node.branches?.[key] ?? null;
        return {
          type: 'advance',
          nextNodeId: nextNodeId ?? null,
        };
      }
      return { type: 'done' };
    }

    default:
      return { type: 'done' };
  }
}

/**
 * Advance the workflow state after an action completes.
 * Stores the result, determines the next node, and updates state in place.
 * Returns the updated state.
 */
export function advanceWorkflow(state, result) {
  const node = state.workflow.nodes?.[state.currentNodeId];

  // Store result under the current node id
  state.context[state.currentNodeId] = result;

  // Determine next node
  let nextNodeId = null;

  if (node) {
    if (result && typeof result === 'object' && result.branch && node.branches) {
      // Branch based on result.branch key
      nextNodeId = node.branches[result.branch] ?? null;
    } else if (node.next !== undefined) {
      nextNodeId = node.next;
    }
  }

  // Push current node to history
  state.history.push(state.currentNodeId);

  if (nextNodeId) {
    state.currentNodeId = nextNodeId;
  } else {
    state.currentNodeId = null;
    state.status = 'done';
  }

  return state;
}
