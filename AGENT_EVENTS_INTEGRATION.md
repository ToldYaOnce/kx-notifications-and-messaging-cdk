# Agent Events Integration - Implementation Summary

**Version:** 1.1.81  
**Date:** 2025-11-25

## 🎯 What Was Implemented

This package now **automatically listens to and handles events from `kx-langchain-agent`**, updating the channels table with workflow state data. This decouples the agent service from direct database writes and commits to a true event-driven architecture.

---

## 🤖 Supported Agent Events

The following events are automatically handled:

| Event Type | What It Does | Updates |
|------------|--------------|---------|
| **`agent.workflow.state_updated`** | Fired after every message | `workflowState` (activeGoals, completedGoals, messageCount, capturedData, contact flags) |
| **`lead.created`** | Lead qualification complete | `leadStatus`, contact info, adds `'lead.created'` to `emittedEvents` |
| **`agent.goal.completed`** | Goal requirements met | Moves goal from `activeGoals` to `completedGoals`, merges `capturedData` |
| **`agent.goal.activated`** | Goal becomes active | Adds goal to `activeGoals`, updates `currentGoalOrder` |
| **`agent.data.captured`** | Individual field extracted | Updates `capturedData`, sets contact capture flags (`isEmailCaptured`, etc.) |
| **`appointment.requested`** | Scheduling goal completes | Adds appointment request to `metadata`, adds event to `emittedEvents` |
| **`agent.workflow.error`** | Error during processing | Logs error (does not throw to avoid breaking event consumer) |

---

## 📦 Channel Schema Changes

### New `workflowState` Field

Added to the `Channel` interface:

```typescript
workflowState?: {
  activeGoals: string[];              // Currently active goal IDs
  completedGoals: string[];           // All completed goal IDs
  currentGoalOrder: number;           // Current goal order in workflow
  messageCount: number;               // Total messages in conversation
  capturedData: Record<string, any>;  // All data captured from user
  isEmailCaptured: boolean;           // Email captured?
  isPhoneCaptured: boolean;           // Phone captured?
  isFirstNameCaptured: boolean;       // First name captured?
  isLastNameCaptured: boolean;        // Last name captured?
  emittedEvents: string[];            // Event types emitted (e.g., 'lead.created')
  lastUpdated: string;                // ISO timestamp of last workflow update
}
```

### Example Channel with Workflow State

```json
{
  "channelId": "f3958a0e-ea7e-40d8-8ef8-b6ad42aeef64",
  "createdAt": "2025-11-23T22:26:34.090Z",
  "tenantId": "tenant_1757418497028_g9o6mnb4m",
  "channelType": "lead",
  "leadStatus": "qualified",
  "botEmployeeIds": ["1478d468-d0a1-70e4-ec4f-f380529a6265"],
  "lastActivity": "2025-11-25T11:44:43.695Z",
  "updated_at": "2025-11-25T11:44:43.695Z",
  "workflowState": {
    "activeGoals": ["establish_trust_1763679387700"],
    "completedGoals": ["collect_identity_1764033358437", "assess_fitness_goals_1764033375877"],
    "currentGoalOrder": 2,
    "messageCount": 33,
    "capturedData": {
      "firstName": "John",
      "lastName": "Smith",
      "email": "john@example.com",
      "phone": "+1-555-0123",
      "fitnessGoals": "Get shredded",
      "primaryGoal": "weight_loss"
    },
    "isEmailCaptured": true,
    "isPhoneCaptured": true,
    "isFirstNameCaptured": true,
    "isLastNameCaptured": true,
    "emittedEvents": ["lead.created"],
    "lastUpdated": "2025-11-25T11:44:43.694Z"
  }
}
```

---

## 🔧 How It Works

### 1. Automatic EventBridge Rules

When the internal event consumer is created, it **automatically creates an EventBridge rule** that listens for all agent events:

```typescript
{
  source: ['kx-langchain-agent'],
  detailType: [
    'agent.workflow.state_updated',
    'lead.created',
    'agent.goal.completed',
    'agent.goal.activated',
    'agent.data.captured',
    'appointment.requested',
    'agent.workflow.error'
  ]
}
```

### 2. Event Routing

When an agent event arrives:
1. EventBridge routes it to the **internal event consumer Lambda**
2. Lambda detects `source === 'kx-langchain-agent'`
3. Routes to appropriate handler based on `detail-type`
4. Handler updates the channels table via DynamoDB

### 3. Channel Updates

Each handler:
- Fetches the current channel (to get `createdAt` sort key)
- Merges new data with existing `workflowState`
- Updates `lastActivity` and `updated_at` timestamps
- Preserves existing fields

---

## 🚀 Usage in Consumer Stack

### No Changes Required! (It's Automatic)

If you're already using this package with `existingEventBus`, the agent event handlers are **enabled by default**.

```typescript
new NotificationMessagingStack(this, 'NotificationsMessaging', {
  resourcePrefix: 'KxGen',
  existingEventBus: eventBus,
  // Agent event handlers are AUTOMATICALLY enabled ✅
});
```

### Disable Agent Event Handlers (If Needed)

If you want to disable automatic channel state updates:

```typescript
new NotificationMessagingStack(this, 'NotificationsMessaging', {
  resourcePrefix: 'KxGen',
  existingEventBus: eventBus,
  internalEventConsumerProps: {
    enableAgentEventHandlers: false  // ❌ Disable agent handlers
  }
});
```

---

## 📊 What Happens When Agent Emits Events

### Example: User Sends Message → Agent Processes → Events Emitted

#### 1. User Message: "My name is John Smith"

**Agent emits:**
- `agent.data.captured` (fieldName: 'firstName', fieldValue: 'John')
- `agent.data.captured` (fieldName: 'lastName', fieldValue: 'Smith')
- `agent.workflow.state_updated` (includes capturedData, contactStatus)

**Channel update:**
```json
{
  "workflowState": {
    "capturedData": { "firstName": "John", "lastName": "Smith" },
    "isFirstNameCaptured": true,
    "isLastNameCaptured": true,
    "lastUpdated": "2025-11-25T12:01:00.000Z"
  }
}
```

#### 2. User Provides Email/Phone → Lead Created

**Agent emits:**
- `agent.data.captured` (fieldName: 'email', fieldValue: 'john@example.com')
- `agent.data.captured` (fieldName: 'phone', fieldValue: '+1-555-0123')
- `agent.goal.completed` (goalId: 'collect_contact_info_...')
- `lead.created` (leadId: channelId, contactInfo: {...})
- `agent.workflow.state_updated`

**Channel update:**
```json
{
  "leadStatus": "qualified",
  "workflowState": {
    "capturedData": {
      "firstName": "John",
      "lastName": "Smith",
      "email": "john@example.com",
      "phone": "+1-555-0123"
    },
    "isEmailCaptured": true,
    "isPhoneCaptured": true,
    "completedGoals": ["collect_identity_...", "collect_contact_info_..."],
    "emittedEvents": ["lead.created"]
  },
  "metadata": {
    "contactInfo": { "firstName": "John", "lastName": "Smith", "email": "john@example.com", "phone": "+1-555-0123" }
  }
}
```

---

## 🔍 Debugging & Monitoring

### CloudWatch Logs

The internal event consumer logs all agent event processing:

```
🤖 Detected agent event, routing to agent handler...
🤖 Handling agent event: agent.workflow.state_updated
🔄 Updating workflow state for channel: f3958a0e-ea7e-40d8-8ef8-b6ad42aeef64
✅ Workflow state updated successfully
```

Search for:
- `🤖` - Agent event detected
- `🔄` - Workflow state update
- `🎯` - Lead creation
- `🎉` - Goal completion
- `🚀` - Goal activation
- `📝` - Data capture
- `📅` - Appointment request
- `⚠️` - Workflow error

### Check EventBridge Rules

Look for the rule named: `{resourcePrefix}-agent-events`

Example: `KxGen-agent-events`

### Verify Channel Updates

Query a channel to see its workflow state:

```bash
# Using AWS CLI
aws dynamodb get-item \
  --table-name KxGen-channels-v2 \
  --key '{"channelId":{"S":"YOUR_CHANNEL_ID"}}'
```

---

## 📚 Event Payload Documentation

All event payloads are documented in:
- **`C:\projects\KxGrynde\kx-langchain-agent\EVENT_PAYLOADS.md`** - Complete payload specs
- **`C:\projects\KxGrynde\kx-langchain-agent\AGENT_EVENT_CATALOG.md`** - Integration guide

---

## ✅ What You Need to Do

### In kx-langchain-agent (Your Agent Project):

1. **Emit events to EventBridge** using the payloads documented in `EVENT_PAYLOADS.md`
2. **Use the correct event source:** `kx-langchain-agent`
3. **Include required fields:** `channelId`, `tenantId`, `timestamp`

### In kx-aws (Your Consumer Stack):

1. **Update to version 1.1.81:**
   ```bash
   npm rm @toldyaonce/kx-notifications-and-messaging-cdk
   npm i @toldyaonce/kx-notifications-and-messaging-cdk@latest
   ```

2. **Deploy:**
   ```bash
   npm run cdk deploy
   ```

3. **That's it!** The agent event handlers are automatically enabled.

---

## 🎓 Benefits

### ✅ Decoupled Architecture
- Agent doesn't need DynamoDB SDK or table names
- Agent just emits events and forgets
- This package owns channel state management

### ✅ Audit Trail
- Every workflow change is tracked in `workflowState.emittedEvents`
- `lastUpdated` timestamp shows when workflow last changed

### ✅ Real-time State
- Channels table always has latest workflow state
- No polling or syncing required

### ✅ Extensible
- Add new event handlers without modifying agent code
- Multiple consumers can listen to same events

---

## 🚨 Important Notes

1. **Channels Must Exist First**
   - Handlers skip updates if channel not found
   - Create channel via `/channels` API before agent starts

2. **Idempotent Updates**
   - Multiple events with same data are safe
   - Last write wins

3. **No Breaking Changes**
   - `workflowState` is optional
   - Existing channels work without it

4. **Error Handling**
   - `agent.workflow.error` events are logged but don't throw
   - Other handler errors throw and trigger EventBridge retry

---

## 📞 Questions?

- **Event payloads:** See `kx-langchain-agent/EVENT_PAYLOADS.md`
- **Integration guide:** See `kx-langchain-agent/AGENT_EVENT_CATALOG.md`
- **This package:** See `README.md`

---

**Ready to go! 🎉** Deploy the consumer stack and start emitting agent events.

