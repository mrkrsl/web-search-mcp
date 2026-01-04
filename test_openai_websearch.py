# run with websearch MCP server

import asyncio
import logging
from agents import Agent, Runner, trace
from openai import AsyncOpenAI
from agents import Agent, OpenAIResponsesModel, Runner, set_tracing_disabled, function_tool
from agents import Agent, Runner, gen_trace_id, trace
from agents.mcp import MCPServer, MCPServerStreamableHttp
from agents.model_settings import ModelSettings

set_tracing_disabled(True)
# logging.basicConfig(level=logging.DEBUG)

#LMStudio
gpt_oss_model = OpenAIResponsesModel(
    model="openai/gpt-oss:20b",
    openai_client=AsyncOpenAI(
        base_url="http://192.168.15.9:1234/v1",
        api_key="lmstudio",
    ),
) 

async def main():
    async with MCPServerStreamableHttp(
        name="Streamable HTTP Python Server",
        params={
            "url": "http://127.0.0.1:8000/mcp",
            "timeout": 30,
        },
        client_session_timeout_seconds=30, # seconds
        cache_tools_list=True,
    ) as server:
        agent = Agent(
            name="Websearch MCP searcher",
            instructions="Use the tools to answer the questions.",
            mcp_servers=[server],
            model_settings=ModelSettings(tool_choice="required"),
            model = gpt_oss_model
        )
        message = "What is the lastest news?"
        print(f"\n\nRunning: {message}")
        with trace("Websearch MCP search example"):
            result = await Runner.run(starting_agent=agent, input=message)
            print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())


