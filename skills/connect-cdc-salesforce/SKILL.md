---
name: connect-cdc-salesforce
description: "Behavioral guidance for Salesforce CDC with Redpanda Connect. Use when: setting up salesforce_cdc, troubleshooting change events, or diagnosing replay ID issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# Salesforce CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting Salesforce CDC with Redpanda Connect. For config field reference and detailed procedures, see the [salesforce_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/salesforce_cdc/).

> **Enterprise Feature**: `salesforce_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **Change Data Capture enabled for objects** — Setup → Integrations → Change Data Capture → Select objects
2. **Connected App configured** — OAuth or JWT authentication configured in Salesforce
3. **API access enabled** — User profile must have API access permission
4. **Appropriate Salesforce edition** — CDC is available on Enterprise, Unlimited, Developer editions

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| CDC not enabled for object | Must explicitly enable in Salesforce Setup for each object |
| Wrong Salesforce edition | CDC not available on all editions. Check your license. |
| OAuth token expiration | Refresh tokens have limited lifetime. Configure token refresh. |
| 3-day replay window | Salesforce retains events for only 3 days. Can't go back further. |
| API limits | CDC events count against API limits. Monitor usage. |
| Sandbox vs Production differences | Test in sandbox, but behavior may differ in production |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Verify CDC is enabled for the target objects in Salesforce Setup |
| Authentication errors | Check Connected App config and OAuth/JWT credentials |
| Can't resume after gap | Events older than 3 days are gone. That's a Salesforce limit. |
| Missing object changes | Object may not have CDC enabled in Setup |
| API limit errors | Monitor API usage; consider event batching |
| License error | `salesforce_cdc` is enterprise — verify Redpanda license is loaded |

## Enabling CDC in Salesforce

1. Go to Setup → Integrations → Change Data Capture
2. Select the objects you want to track
3. Save changes
4. Note: Standard objects and custom objects are in separate lists

## Replay ID and retention

Salesforce CDC uses replay IDs for resumption:
- Events retained for **3 days** (not configurable)
- Replay ID `-1` = only new events
- Replay ID `-2` = all available events (up to 3 days)
- Specific replay ID = resume from that point

If connector is down > 3 days, you cannot recover missed events.

## Authentication options

- **OAuth 2.0 Web Flow**: Interactive, requires refresh token handling
- **OAuth 2.0 JWT Bearer**: Server-to-server, certificate-based
- **Username-Password Flow**: Simpler but less secure

JWT Bearer is recommended for production CDC pipelines.

## When to escalate

- Replay ID errors or gaps
- Unexpected event loss
- High-volume object change handling
- Multi-org considerations

**Docs**: [salesforce_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/salesforce_cdc/)
