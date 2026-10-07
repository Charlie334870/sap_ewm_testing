# How the platform reaches SAP

This document records which mechanisms are used to read from SAP, why, and what has and has not
been verified. It follows the rule from the master prompt: no SAP API, table or field is used
from memory. `TODO – verify` marks what is still unconfirmed.

## Three kinds of connection

| Kind                | What answers                                                             | Cost | Tools that work | State                           |
| ------------------- | ------------------------------------------------------------------------ | ---- | --------------- | ------------------------------- |
| Simulated           | A built-in practice warehouse with planted faults. No SAP involved.      | Free | All 11          | Built and tested                |
| SAP API sandbox     | SAP's public sandbox at api.sap.com: real SAP software, SAP's demo data. | Free | 6 of 11         | Built; first real call is yours |
| Customer SAP system | A client's or your own S/4HANA with embedded EWM.                        | Paid | Target: all     | Not built. Milestone 6.         |

Every tool result carries its source. Simulated data is marked with hazard tape, sandbox data
with an _SAP sandbox_ tag. A customer system cannot be registered yet, so nothing can be
mistaken for one.

## Connect SAP's API sandbox (free, about 10 minutes)

This is a real connection: your platform sends HTTPS requests to SAP and SAP answers. It proves
the connector against real SAP software. It is not your project's system and the data is SAP's
demo data, so it cannot be used to diagnose a client's ticket.

1. Make sure `SECRETS_KEY` is set in `.env` (see [SETUP.md](SETUP.md), step 3) and the platform
   has been restarted since.
2. Go to <https://api.sap.com> and sign in with your SAP ID (your SAP Universal ID works).
3. Open any API package for SAP S/4HANA Cloud, open an API, and choose **Show API Key**. Copy
   the key. Do not paste it into a chat or an email.
4. In the console: **SAP Systems** → _Register a system_ → _SAP API sandbox_. Paste the key and
   register.
5. Open the new system `SBX` and press **Test connection**.

### What the connection test tells you

For each SAP service behind a tool, the test asks SAP for the service's own description, compares
it with the definition the tool was built on, and reads one row.

| Result                             | Meaning                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Answers as expected                | The tool can run. The last column shows real values (a warehouse, a document) to try it with. |
| Changed since the tools were built | SAP's service no longer has a property the tool filters on. The tool is switched off.         |
| Not on this system                 | SAP has removed or replaced the service. The tool is switched off.                            |
| Access refused                     | The key is wrong or expired, or a proxy or firewall blocks sandbox.api.sap.com.               |

**Please send me a screenshot of this table after your first test.** It is the first time the
connector meets real SAP, and it tells me exactly which bindings need adjusting.

## Why these mechanisms

| Mechanism                                                       | Used for                                                            | Position                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAP's released OData APIs for warehouse management              | Deliveries, warehouse orders and tasks, handling units, stock, bins | **In use** for the sandbox. Definitions taken from SAP's own published clients (see below).                                                                                      |
| Own read-only ABAP services (the planned "EWM Agent Connector") | Queues, application log, PPF actions, dumps, customizing            | **Not built.** SAP has released no API for these. On the sandbox the five tools are refused with that reason. Designed with Milestone 6, on a system where ABAP can be deployed. |
| ADT REST interface                                              | Reading ABAP source                                                 | Not built. `TODO – verify` authorisations for read-only use.                                                                                                                     |
| RFC, SAP GUI scripting                                          | Nothing                                                             | Avoided. See the architecture document, section 4.2.                                                                                                                             |
| MCP                                                             | Between an agent and the platform's tools                           | **In use.** `apps/mcp` exposes the tools to Claude. It is a relay; all rules are enforced by the platform.                                                                       |

### Where the SAP definitions come from

`packages/sap-tools/src/odata/reference/sap-api-metadata.json` holds the service paths, entity
sets and property names the connector uses. They were extracted from SAP's own published API
clients on npm, version 2.1.0:

| SAP service                 | Tool                                         | OData | SAP package                                                    |
| --------------------------- | -------------------------------------------- | ----- | -------------------------------------------------------------- |
| `API_WHSE_OUTB_DLV_ORDER`   | `get_delivery` (outbound)                    | V2    | `@sap/cloud-sdk-vdm-warehouse-outbound-delivery-order-service` |
| `API_WHSE_INBOUND_DELIVERY` | `get_delivery` (inbound)                     | V2    | `@sap/cloud-sdk-vdm-warehouse-inbound-delivery-service`        |
| `API_WAREHOUSE_ORDER_TASK`  | `get_warehouse_tasks`, `get_warehouse_order` | V2    | `@sap/cloud-sdk-vdm-warehouse-task-service`                    |
| `API_HANDLING_UNIT`         | `get_handling_unit`                          | V2    | `@sap/cloud-sdk-vdm-handling-unit-service`                     |
| `api_whse_availablestock`   | `get_stock`                                  | V4    | `@sap/cloud-sdk-vdm-warehouse-available-stock-service`         |
| `API_WAREHOUSE_STORAGE_BIN` | `get_storage_bin`                            | V2    | `@sap/cloud-sdk-vdm-warehouse-storage-bin-service`             |

A test fails if a binding uses a service, entity set or property that is not in that file.

## What is verified and what is not

| Statement                                                                           | Status                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The connector sends only GET requests and puts the key in the `APIKey` header       | Verified by tests.                                                                                                                                |
| The connector reads and maps data in the shape SAP published                        | Verified by tests against a stand-in generated from SAP's definitions.                                                                            |
| SAP's sandbox still offers these services, with these properties, at these paths    | `TODO – verify`. The definitions are from 2022. Your first connection test verifies it.                                                           |
| The sandbox accepts the filters the tools send (for example tasks by delivery)      | `TODO – verify` with the first real tool calls. SAP's own error text is shown if it does not.                                                     |
| Document numbers need leading zeros                                                 | `TODO – verify`. Unknown. Use the example values from the connection test first.                                                                  |
| A successor service `api_warehouse_order_task_2` exists at the path the test probes | `TODO – verify`. The path is not from an SAP source, so no tool uses it. The test only reports whether it exists and what it exposes.             |
| The same OData services exist on an on-premise S/4HANA with embedded EWM            | `TODO – verify` on a real system. An SAP Community answer said no for release 2020; SAP Help now lists them for on-premise. See architecture 4.2. |
| Status codes (for example `GoodsIssueStatus`)                                       | Passed through as SAP returns them. Their meaning is not interpreted anywhere in the platform.                                                    |

## Limits of the sandbox

- It is S/4HANA Cloud demo data, not embedded EWM on-premise, and not your warehouse.
- Nobody can plant a fault in it, so it cannot be used for the practice scenarios.
- `get_stock` returns available stock only; SAP's service does not report physical stock.
- A warehouse order comes without its creation rule and queue; SAP's service does not expose them.
- Only `https://sandbox.api.sap.com` is accepted as the address. Any other host is refused, so
  the platform cannot be pointed at an arbitrary server.

## Path to a customer system (Milestone 6)

1. A system: the S/4HANA Fully-Activated Appliance trial (paid hosting) or a client DEV system
   with written permission for AI tool access.
2. A read-only technical user, and a way for the system to state its own system ID and client so
   the environment check is real, not assumed.
3. The EWM Agent Connector: a small read-only ABAP package for queues, logs, PPF, dumps and
   customizing.
4. Run the connection test and the same tool tests against it before any ticket is diagnosed.
