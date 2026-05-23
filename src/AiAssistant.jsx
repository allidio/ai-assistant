import { useState, useRef, useEffect, useCallback } from 'react'
import { defaultTools, toolsToOpenAIFunctions } from './tools.js'
import { buildClassificationPrompt, resolveClassification, createWorkflowState, getNextAction, advanceWorkflow } from './workflowEngine.js'
import PointerOverlay from './PointerOverlay.jsx'
import './AiAssistant.css'

const MAX_TOOL_ROUNDS = 10

const DEFAULT_PROXY_URL = 'http://localhost:3456/api/ai/responses'

export default function AiAssistant({
  children,
  agentKey,
  proxyUrl,
  tools: customTools,
  extraTools = [],
  workflows = [],
}) {
  const PROXY_URL = proxyUrl || DEFAULT_PROXY_URL
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [prevResponseId, setPrevResponseId] = useState(null)
  const [ragPipelines, setRagPipelines] = useState([])
  const containerRef = useRef(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const tools = customTools || [...extraTools, ...defaultTools]
  const openAIFunctions = toolsToOpenAIFunctions(tools)
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))

  // Fetch available RAG pipelines from backend
  useEffect(() => {
    if (!agentKey) return
    const pipelinesUrl = PROXY_URL.replace('/responses', '/rag-pipelines')
    fetch(pipelinesUrl, {
      headers: { 'x-agent-key': agentKey },
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.pipelines) setRagPipelines(data.pipelines) })
      .catch(() => {})
  }, [agentKey, PROXY_URL])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  async function callResponses(inputPayload, prevId, { rag, instructions } = {}) {
    const body = {
      input: inputPayload,
      tools: openAIFunctions,
    }
    if (prevId) {
      body.previous_response_id = prevId
    }
    if (rag !== undefined) {
      body.rag = rag
    }
    if (instructions) {
      body.instructions = instructions
    }

    const headers = { 'Content-Type': 'application/json' }
    if (agentKey) {
      headers['x-agent-key'] = agentKey
    }

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`API error: ${response.status} ${err}`)
    }

    return response.json()
  }

  async function executeTool(name, args) {
    const tool = toolMap[name]
    if (!tool) return { error: `Unknown tool: ${name}` }
    try {
      return await tool.execute(args, containerRef)
    } catch (err) {
      return { error: err.message }
    }
  }

  function extractLLMText(result) {
    const textItems = result.output.filter(
      (item) => item.type === 'message' && item.role === 'assistant'
    )
    if (textItems.length > 0) {
      const contentParts = textItems[0].content || []
      return contentParts
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('') || null
    }
    return null
  }

  function tryParseJSON(text) {
    if (!text) return null
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }

  async function runWorkflow(workflow, text, currentMessages) {
    const state = createWorkflowState(workflow, text)
    let maxSteps = 15
    const log = (msg, data) => console.log(`%c[workflow:${workflow.id}]%c ${msg}`, 'color:#8b5cf6;font-weight:bold', 'color:inherit', data !== undefined ? data : '')

    log(`started → node: "${state.currentNodeId}"`)

    while (state.status === 'running' && maxSteps-- > 0) {
      const action = getNextAction(state)
      log(`node "${state.currentNodeId}" → action: ${action.type}`, action)

      if (action.type === 'done') {
        log('done (no more nodes)')
        state.status = 'done'
        break
      }

      if (action.type === 'advance') {
        log(`condition → next: "${action.nextNodeId}"`)
        state.history.push(state.currentNodeId)
        if (action.nextNodeId) {
          state.currentNodeId = action.nextNodeId
        } else {
          state.currentNodeId = null
          state.status = 'done'
        }
        continue
      }

      if (action.type === 'tool') {
        log(`tool call: ${action.toolName}`, action.args)
        const toolResult = await executeTool(action.toolName, action.args)
        log(`tool result: ${action.toolName}`, toolResult)
        currentMessages = [...currentMessages, {
          role: 'tool-display',
          name: action.toolName,
          args: action.args,
          result: toolResult,
        }]
        setMessages([...currentMessages])
        advanceWorkflow(state, toolResult)
        log(`advanced → node: "${state.currentNodeId}", status: ${state.status}`)
        continue
      }

      if (action.type === 'llm') {
        log(`llm call (rag: ${JSON.stringify(action.rag)})`, action.prompt.slice(0, 200) + '...')
        const result = await callResponses(action.prompt, prevResponseId, {
          rag: action.rag,
        })
        setPrevResponseId(result.id)

        const functionCalls = result.output.filter((item) => item.type === 'function_call')
        if (functionCalls.length > 0) {
          log('llm returned function calls — breaking out of workflow', functionCalls.map(fc => fc.name))
          return { result, currentMessages, handledByWorkflow: false }
        }

        const responseText = extractLLMText(result)
        const parsed = tryParseJSON(responseText)
        log('llm response', { parsed, responseText: responseText?.slice(0, 300) })

        if (parsed && parsed.branch) {
          advanceWorkflow(state, parsed)
          log(`branch → "${parsed.branch}" → node: "${state.currentNodeId}"`)
        } else if (parsed && parsed.sku_ids) {
          advanceWorkflow(state, parsed)
          log(`extracted sku_ids → node: "${state.currentNodeId}"`, parsed.sku_ids)
        } else {
          if (responseText) {
            const assistantMsg = { role: 'assistant', content: responseText }
            currentMessages = [...currentMessages, assistantMsg]
            setMessages([...currentMessages])
          }
          advanceWorkflow(state, { text: responseText })
          log(`text response → node: "${state.currentNodeId}", status: ${state.status}`)
        }
        continue
      }
    }

    if (maxSteps <= 0) log('hit max steps limit')
    log('workflow complete', { status: state.status, history: state.history, context: state.context })
    return { currentMessages, handledByWorkflow: true }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)

    try {
      // Try LLM-based workflow + RAG classification
      let workflow = null
      let ragScope = undefined // undefined = let backend decide
      if (workflows.length > 0 || ragPipelines.length > 0) {
        const classifyPrompt = buildClassificationPrompt(text, workflows, ragPipelines)
        if (classifyPrompt) {
          const classifyResult = await callResponses(classifyPrompt, prevResponseId, { rag: false })
          setPrevResponseId(classifyResult.id)
          const classifyText = extractLLMText(classifyResult)
          console.log('%c[classify]%c LLM response:', 'color:#8b5cf6;font-weight:bold', 'color:inherit', classifyText)
          const classification = resolveClassification(classifyText, workflows, ragPipelines)
          workflow = classification.workflow
          ragScope = classification.rag
          console.log('%c[classify]%c result:', 'color:#8b5cf6;font-weight:bold', 'color:inherit', {
            workflow: workflow?.id || 'none',
            rag: ragScope,
          })
        }
      }

      if (workflow) {
        const wfResult = await runWorkflow(workflow, text, newMessages)
        if (wfResult.handledByWorkflow) {
          setLoading(false)
          return
        }
        // If workflow couldn't handle it, fall through to normal flow
      }

      // Normal LLM flow (no workflow match or workflow fallthrough)
      // Use the LLM-selected RAG scope
      let result = await callResponses(text, prevResponseId, { rag: ragScope })
      let responseId = result.id
      let rounds = 0
      let currentMessages = [...newMessages]

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++

        const functionCalls = result.output.filter((item) => item.type === 'function_call')
        const textItems = result.output.filter(
          (item) => item.type === 'message' && item.role === 'assistant'
        )

        if (functionCalls.length > 0) {
          const toolResultInputs = []
          const displayEntries = []

          for (const fc of functionCalls) {
            const args = JSON.parse(fc.arguments || '{}')
            const toolResult = await executeTool(fc.name, args)
            const resultStr = JSON.stringify(toolResult)

            toolResultInputs.push({
              type: 'function_call_output',
              call_id: fc.call_id,
              output: resultStr,
            })

            displayEntries.push({
              role: 'tool-display',
              name: fc.name,
              args,
              result: toolResult,
            })
          }

          currentMessages = [...currentMessages, ...displayEntries]
          setMessages([...currentMessages])

          result = await callResponses(toolResultInputs, responseId)
          responseId = result.id
        } else {
          let responseText = '(No response)'
          if (textItems.length > 0) {
            const contentParts = textItems[0].content || []
            responseText = contentParts
              .filter((c) => c.type === 'output_text')
              .map((c) => c.text)
              .join('') || '(No response)'
          }

          const assistantMsg = { role: 'assistant', content: responseText }
          currentMessages = [...currentMessages, assistantMsg]
          setMessages([...currentMessages])
          setPrevResponseId(responseId)
          break
        }
      }

      if (rounds >= MAX_TOOL_ROUNDS) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'I reached the maximum number of tool calls. Let me know if you need more help.' },
        ])
        setPrevResponseId(responseId)
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function renderMessage(msg, i) {
    if (msg.role === 'user') {
      return (
        <div key={i} className="ai-assistant-msg ai-assistant-msg-user">
          {msg.content}
        </div>
      )
    }
    if (msg.role === 'assistant') {
      return (
        <div key={i} className="ai-assistant-msg ai-assistant-msg-assistant">
          {msg.content}
        </div>
      )
    }
    if (msg.role === 'tool-display') {
      return (
        <div key={i} className="ai-assistant-msg ai-assistant-msg-tool">
          <details>
            <summary>{msg.name}({Object.keys(msg.args).length ? JSON.stringify(msg.args) : ''})</summary>
            <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>
              {JSON.stringify(msg.result, null, 2).slice(0, 500)}
            </pre>
          </details>
        </div>
      )
    }
    return null
  }

  return (
    <>
      <div ref={containerRef}>
        {children}
      </div>

      <PointerOverlay />

      <button
        className="ai-assistant-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {open ? (
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="ai-assistant-panel">
          <div className="ai-assistant-panel-header">
            <h3>AI Assistant</h3>
            <button className="ai-assistant-close-btn" onClick={() => setOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="ai-assistant-messages">
            {messages.length === 0 && (
              <div className="ai-assistant-welcome">
                <strong>Hey! I'm your AI assistant.</strong>
                Ask me anything. I can read the page, click buttons, navigate, and help you explore.
              </div>
            )}
            {messages.map(renderMessage)}
            {loading && (
              <div className="ai-assistant-typing">
                <span /><span /><span />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-assistant-input-area">
            <textarea
              ref={inputRef}
              className="ai-assistant-input"
              placeholder="Ask something..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <button
              className="ai-assistant-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || loading}
            >
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
