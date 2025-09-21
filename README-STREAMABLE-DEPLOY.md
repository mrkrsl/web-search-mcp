# Web Search MCP Server - StreamableHttp Docker Deploy

Questo documento descrive come utilizzare il server MCP Web Search con il nuovo transport **StreamableHttp** dockerizzato per l'integrazione con LiteLLM e altri gateway AI.

## 🚀 Panoramica

Il server MCP Web Search supporta:

- ✅ **StreamableHttp transport** (nuovo standard MCP 2025-06-18)
- ✅ **HTTP/REST endpoints** per chiamate dirette ai tools
- ✅ **Docker containerization** con multi-stage build
- ✅ **Health checks** e monitoring
- ✅ **Integrazione con LiteLLM** e altri gateway

## 📁 Struttura del Progetto

```
web-search-mcp/
├── src/
│   ├── index.ts                  # Server stdio originale
│   ├── streamable-server.ts      # Server StreamableHttp
│   └── ...                       # Altri file esistenti
├── Dockerfile                    # Multi-stage Docker build
├── docker-compose.yml            # Server MCP StreamableHttp
├── mcp.json                     # Configurazioni MCP (stdio + StreamableHttp)
└── README-SSE-DEPLOY.md         # Questa documentazione
```

## 🔧 Setup e Deployment

### 1. Installazione Dipendenze

```bash
# Le dipendenze sono già configurate nel package.json
npm install
```

### 2. Build e Test Locale

```bash
# Build del progetto
npm run build

# Test locale del server StreamableHttp
npm run dev:streamable

# Il server sarà disponibile su http://localhost:3001
```

### 3. Deploy con Docker

```bash
# Deploy solo server MCP StreamableHttp
docker-compose up -d
```

### 4. Verifica Deployment

```bash
# Health check
curl http://localhost:3001/health

# Info server MCP
curl http://localhost:3001/mcp/info

# Test endpoint StreamableHttp (esempio inizializzazione)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

## 🌐 Endpoints del Server StreamableHttp

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/health` | GET | Health check del server |
| `/mcp/info` | GET | Informazioni sul server MCP |
| `/mcp` | POST | Endpoint StreamableHttp per comunicazione MCP |

### Esempi di chiamate MCP via StreamableHttp:

**Inizializzazione:**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

**Lista tools disponibili:**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

**Chiamata tool:**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"get-web-search-summaries",
      "arguments":{"query":"latest AI news","limit":3}
    }
  }'
```

## 🔗 Integrazione con LiteLLM

### 1. Configurazione LiteLLM

Il file `litellm-config.yaml` dovrebbe essere configurato così:

```yaml
model_list:
  - model_name: gpt-4
    litellm_params:
      model: openai/gpt-4
      api_key: "your-openai-api-key"
  
  - model_name: claude-3
    litellm_params:
      model: anthropic/claude-3-sonnet-20240229
      api_key: "your-anthropic-api-key"

tools:
  - name: web-search-mcp
    type: mcp
    config:
      transport:
        type: http
        url: "http://web-search-mcp:3001/mcp"

general_settings:
  master_key: "your-master-key"
```

### 2. Configurazione MCP Client

**Per Claude Desktop, aggiorna `claude_desktop_config.json`:**

```json
{
  "mcpServers": {
    "web-search-local": {
      "transport": {
        "type": "http",
        "url": "http://localhost:3001/mcp"
      }
    },
    "web-search-remote": {
      "transport": {
        "type": "http",
        "url": "https://your-domain.com/mcp"
      }
    }
  }
}
```

### 3. Test Integrazione LiteLLM

```bash
# Test con tool web search via LiteLLM
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-master-key" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Search for latest news about artificial intelligence"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "full-web-search",
          "description": "Search the web and fetch complete page content",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {"type": "string"},
              "limit": {"type": "number", "default": 5}
            },
            "required": ["query"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

## 🔐 Configurazione Produzione

### 1. Variabili d'Ambiente

Crea il file `.env`:

```bash
# Server configuration
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Optional: Search engine configuration
SEARCH_TIMEOUT=30000
MAX_CONTENT_LENGTH=50000
CONCURRENT_REQUESTS=3
```

### 2. Deploy Produzione

```bash
# Deploy in produzione (il reverse proxy SSL è esterno)
docker-compose up -d

# Oppure con LiteLLM integrato
docker-compose -f docker-compose-full.yml up -d
```

## 🔄 Aggiornamenti e Manutenzione

### 1. Update del Container

```bash
# Rebuild e restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 2. Logs e Monitoring

```bash
# Visualizza logs
docker-compose logs -f web-search-mcp-sse

# Monitoring risorse
docker stats web-search-mcp-sse

# Health check periodico
watch -n 30 'curl -s http://localhost:3001/health | jq'
```

### 3. Backup e Recovery

```bash
# Backup configurazione
tar -czf backup-$(date +%Y%m%d).tar.gz \
  docker-compose.yml nginx.conf .env ssl/

# Restore
tar -xzf backup-YYYYMMDD.tar.gz
```

## 🐛 Troubleshooting

### Problemi Comuni

1. **Container non si avvia**:
   ```bash
   docker logs web-search-mcp-sse
   ```

2. **SSE connection fails**:
   - Verifica CORS headers
   - Controlla firewall/proxy settings
   - Test con curl -N

3. **Tool calls falliscono**:
   - Verifica formato JSON request
   - Controlla parametri richiesti
   - Test endpoint diretto HTTP

4. **Performance issues**:
   - Aumenta timeout configurazioni
   - Limita concurrent requests
   - Monitora memoria Docker

### Log Analysis

```bash
# Analisi errori comuni
docker logs web-search-mcp-sse 2>&1 | grep ERROR
docker logs web-search-mcp-sse 2>&1 | grep "Tool call"
docker logs web-search-mcp-sse 2>&1 | grep "SSE"
```

## 📊 Configurazione MCP Client

### Per Claude Desktop

Aggiorna `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "web-search-sse-local": {
      "transport": {
        "type": "sse",
        "url": "http://localhost:3001/mcp/sse"
      }
    },
    "web-search-sse-remote": {
      "transport": {
        "type": "sse",
        "url": "https://your-domain.com/mcp/sse"
      }
    }
  }
}
```

### Per Altri Client MCP

```javascript
// Esempio connessione MCP SSE
const client = new McpClient({
  transport: {
    type: 'sse',
    url: 'https://your-domain.com/mcp/sse'
  }
});

await client.connect();

// Chiamata tool
const result = await client.callTool('full-web-search', {
  query: 'latest AI news',
  limit: 5
});
```

## 🚀 Deploy su Cloud Providers

### AWS ECS

```yaml
# task-definition.json per ECS
{
  "family": "web-search-mcp-sse",
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "web-search-mcp",
      "image": "your-ecr-repo/web-search-mcp-sse:latest",
      "portMappings": [
        {
          "containerPort": 3001,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3001"}
      ]
    }
  ]
}
```

### Google Cloud Run

```yaml
# cloudrun.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: web-search-mcp-sse
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: "10"
    spec:
      containers:
      - image: gcr.io/your-project/web-search-mcp-sse
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: production
        - name: PORT
          value: "3001"
```

### Azure Container Instances

```bash
# Deploy su Azure
az container create \
  --resource-group myResourceGroup \
  --name web-search-mcp-sse \
  --image your-registry.azurecr.io/web-search-mcp-sse:latest \
  --dns-name-label web-search-mcp \
  --ports 3001 \
  --environment-variables NODE_ENV=production PORT=3001
```

## 📈 Monitoraggio e Osservabilità

### Metriche da Monitorare

- Request rate per endpoint
- Response time tool calls
- SSE connection count
- Memory/CPU usage
- Error rate per tool

### Setup Prometheus + Grafana

Aggiungi al `docker-compose.yml`:

```yaml
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

Con questo setup completo, hai un server MCP web search completamente dockerizzato, scalabile e integrabile con qualsiasi gateway AI che supporti il protocollo MCP via SSE! 🎉