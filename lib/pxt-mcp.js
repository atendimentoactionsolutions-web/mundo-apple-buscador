/**
 * CLIENTE OFICIAL MCP - BUSCADOR PXT
 * Comunicação direta via JSON-RPC com o servidor MCP oficial da PXT.
 * Endpoint: https://backend-api.buscadorpxt.com.br/mcp
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Carregar variáveis de ambiente
const envPath = path.join(__dirname, '..', '.env');
let MCP_URL = process.env.PXT_MCP_URL || 'https://backend-api.buscadorpxt.com.br/mcp';
let MCP_TOKEN = process.env.PXT_MCP_TOKEN || '';

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key === 'PXT_MCP_URL') MCP_URL = val;
      if (key === 'PXT_MCP_TOKEN') MCP_TOKEN = val;
    }
  }
}

let requestId = 1;

async function callMcpTool(name, args = {}) {
  const currentId = requestId++;
  const payload = {
    jsonrpc: '2.0',
    id: currentId,
    method: 'tools/call',
    params: {
      name,
      arguments: args
    }
  };

  const response = await axios.post(MCP_URL, payload, {
    headers: {
      'Authorization': `Bearer ${MCP_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    timeout: 10000
  });

  const result = response.data?.result;
  if (!result) {
    if (response.data?.error) {
      throw new Error(`[PXT MCP Error] ${response.data.error.message || JSON.stringify(response.data.error)}`);
    }
    throw new Error('[PXT MCP] Resposta vazia ou inesperada.');
  }

  // MCP Content pode ser array com objeto { type: 'text', text: '...' }
  const textContent = result.content?.[0]?.text;
  if (textContent) {
    try {
      return JSON.parse(textContent);
    } catch (e) {
      return textContent;
    }
  }
  return result;
}

// 1. Consultar Margens da Conta
async function consultarMargens(pagina = 1) {
  return await callMcpTool('consultar_margens', { pagina });
}

// 2. Consultar Categorias Oficiais
async function consultarCategorias() {
  return await callMcpTool('consultar_categorias', {});
}

// 3. Resolver Configuração de Modelo
async function resolverConfiguracao(params) {
  return await callMcpTool('resolver_configuracao', params);
}

// 4. Aplicar Margem
async function aplicarMargem(params) {
  return await callMcpTool('aplicar_margem', params);
}

// 5. Remover Margem
async function removerMargem(margemId) {
  return await callMcpTool('remover_margem', { margemId });
}

// 6. Consultar Proposta
async function consultarProposta(propostaId) {
  return await callMcpTool('consultar_proposta', { propostaId });
}

module.exports = {
  callMcpTool,
  consultarMargens,
  consultarCategorias,
  resolverConfiguracao,
  aplicarMargem,
  removerMargem,
  consultarProposta
};
