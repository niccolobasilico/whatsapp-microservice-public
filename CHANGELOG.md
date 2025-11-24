# Changelog

All notable changes to the WhatsApp Microservice project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🔥 Critical Fixes

#### [Hotfix] - 2025-01-23 - Circular Import Fix
- **Fixed**: HTTP 500 error caused by circular import in SSE broadcast
- **Impact**: QR code generation was broken, all API endpoints failing
- **Solution**: Removed dynamic import, reverted to stable polling mechanism
- **Status**: Messages now appear via 5-second polling (reliable and functional)
- **Commit**: `a35427b`

### ✨ Features Added

#### Real-Time Messaging Infrastructure - 2025-01-23
- **Added**: Server-Sent Events (SSE) endpoint `/session/:sessionId/messages/stream`
- **Added**: Message history endpoint with pagination `/session/:sessionId/messages`
- **Added**: Tenant-wide message aggregation `/tenant/messages`
- **Added**: Polling fallback mechanism (5-second intervals)
- **Features**:
  - Real-time message streaming with heartbeat keep-alive
  - Automatic reconnection on SSE failure
  - Message deduplication and merge intelligence
  - Connection status tracking
- **Commits**: `0efcc37`, Initial implementation

#### Session Management Improvements - 2025-01-23
- **Added**: Complete session deletion endpoint `DELETE /session/:sessionId`
- **Added**: QR code regeneration endpoint `POST /session/:sessionId/regenerate-qr`
- **Added**: `SessionManager.deleteSession()` - removes socket, auth files, and DB record
- **Added**: `SessionManager.regenerateQR()` - forces fresh QR generation
- **Added**: `TenantSessionService.deleteSession()` with tenant authorization
- **Security**: Tenant ownership verification before deletion
- **Commit**: `2ded13a`

#### Message Ordering Fix - 2025-01-23
- **Fixed**: Message chronological ordering (oldest → newest)
- **Changed**: Backend query from `ascending: false` to `ascending: true`
- **Changed**: Frontend message append logic (add to end instead of beginning)
- **Impact**: Chat now displays in natural order with newest at bottom
- **Commit**: `d1ae5ad`

#### Image Rendering Fix - 2025-01-23
- **Fixed**: Received images now render correctly from `metadata.filePath`
- **Added**: Click-to-open images in new tab
- **Added**: Error handling for failed image loads
- **Added**: Date separators between different days
- **Added**: Status indicators (Failed, Queued, Sent)
- **Commit**: `2371e84`

### 🎨 UI/UX Improvements

#### Chat Interface Redesign - 2025-01-23
- **Added**: WhatsApp-style bubble chat design (reverted later)
- **Restored**: Original blue color scheme per user preference
- **Added**: Formatted timestamps (HH:MM)
- **Added**: Contact info display below bubbles
- **Added**: File size display for video/documents
- **Improved**: Chat max height from 400px to 500px
- **Commits**: `c2d26ba`, `6495cc2`

### 🐛 Bug Fixes

#### Media Upload Fixes - 2025-01-23
- **Fixed**: "Failed to fetch" error when sending attachments
- **Fixed**: Express JSON body limit increased from 100kb to 20mb
- **Fixed**: Browser timeout extended to 120 seconds
- **Fixed**: Two-pass image compression (1.5MB → 1MB if needed)
- **Fixed**: Base64 size validation before upload
- **Impact**: Images and media now upload reliably
- **Related Commits**: Multiple fixes across sessions

#### API Response Handling - 2025-01-23
- **Fixed**: "body stream already read" error on DELETE operations
- **Fixed**: Proper handling of 204 No Content responses
- **Fixed**: Response.text() called only once
- **Added**: 120-second timeout with AbortController
- **Added**: Better error messages for timeouts and network errors

### 📚 Documentation

#### Comprehensive Documentation - 2025-01-23
- **Added**: `README.md` with enterprise features section
- **Added**: `BACKEND_UPDATES.md` - complete backend endpoint guide
- **Added**: `DEPLOYMENT_GUIDE.md` - step-by-step deployment
- **Added**: `IMPLEMENTATION_SUMMARY.md` - technical overview
- **Added**: Integration examples for SaaS clients
- **Added**: This `CHANGELOG.md`

### 🔧 Technical Improvements

#### Enhanced Logging - 2025-01-23
- **Added**: Detailed console logs with emoji indicators
- **Added**: "✅ Registered messages.upsert event handler"
- **Added**: "📬 Received X message(s) from Baileys"
- **Added**: "📡 Broadcasted message to SSE clients"
- **Added**: Message save confirmation with DB ID
- **Impact**: Better debugging and monitoring capabilities

#### Database Improvements - 2025-01-23
- **Changed**: `insertIncomingMessage()` now returns saved message with ID
- **Added**: `.select().single()` to get inserted record
- **Impact**: Better tracking and potential for future SSE broadcast

### ⚙️ Configuration Changes

#### Express Middleware - 2025-01-23
- **Changed**: `express.json({ limit: '20mb' })` (was 100kb)
- **Impact**: Supports larger media file uploads

#### Frontend API Timeouts - 2025-01-23
- **Changed**: Request timeout from ~30s to 120s
- **Added**: AbortController for proper timeout handling
- **Impact**: Large file uploads no longer timeout

### 🚀 Performance Improvements

#### Image Compression - 2025-01-23
- **Added**: Two-pass compression strategy
  - First pass: 1.5MB target, 85% quality
  - Second pass: 1MB target, 75% quality (if still too large)
- **Added**: Pre-validation of estimated base64 size
- **Impact**: Reduced upload sizes, faster transmission

#### Message Polling Optimization - 2025-01-23
- **Added**: Smart polling that only fetches new messages
- **Added**: Timestamp-based filtering
- **Added**: Deduplication logic
- **Impact**: Reduced unnecessary database queries

### 🔒 Security Enhancements

#### Session Deletion Security - 2025-01-23
- **Added**: Tenant ownership verification before deletion
- **Added**: Proper auth cleanup to prevent credential leakage
- **Added**: Graceful error handling for failed logouts
- **Impact**: Prevents unauthorized session access

### 🗑️ Deprecated

#### SSE Real-Time Broadcast - 2025-01-23
- **Status**: Temporarily disabled due to circular import issue
- **Reason**: Caused HTTP 500 errors and system instability
- **Alternative**: Polling mechanism (5-second intervals)
- **Future**: Will be re-implemented with proper architecture

### 📝 Known Issues

#### Real-Time Updates - Current
- **Issue**: Messages appear with ~5 second delay (polling interval)
- **Workaround**: Polling mechanism is reliable and functional
- **Future Fix**: Proper SSE implementation planned with event emitter pattern

#### Baileys Stability - Ongoing
- **Issue**: Baileys library occasionally has connection issues
- **Workaround**: Auto-reconnection mechanism with exponential backoff
- **Note**: QR code regeneration endpoint available for manual reconnection

### 🏗️ Architecture Changes

#### Message Flow (Current) - 2025-01-23
```
WhatsApp → Baileys → SessionManager
              ↓
       Save to Database
              ↓
       Polling (5s interval)
              ↓
       Frontend Update
```

#### Message Flow (Planned)
```
WhatsApp → Baileys → SessionManager
              ↓
       Save to Database
              ↓
       Event Emitter → SSE Broadcast
              ↓
       Frontend Update (Instant)
```

### 📊 API Endpoints Added

#### Session Management
- `DELETE /session/:sessionId` - Complete session deletion
- `POST /session/:sessionId/regenerate-qr` - Force QR regeneration
- `POST /session/:sessionId/disconnect` - Disconnect session (existing)

#### Messaging
- `GET /session/:sessionId/messages` - Message history with pagination
- `GET /session/:sessionId/messages/stream` - SSE real-time stream (disabled)
- `GET /tenant/messages` - Multi-session message aggregation

#### Status & Info
- `GET /session/:sessionId/qr` - Get QR code (existing)
- `GET /session/:sessionId/status` - Get session status (existing)

### 🎯 Frontend Changes

#### API Client Updates - 2025-01-23
- **Added**: `api.regenerateSessionQR()` - Regenerate QR code
- **Updated**: `api.deleteSession()` - Now works correctly
- **Added**: `api.getMessages()` - Fetch message history
- **Added**: `api.getTenantMessages()` - Fetch all tenant messages

#### Chat Component Updates - 2025-01-23
- **Added**: `useMessagesStream` hook for real-time updates
- **Added**: Date separators
- **Added**: Status indicators
- **Improved**: Image rendering from backend
- **Improved**: Media file display with file sizes

### 📦 Dependencies

No new dependencies added. Using existing stack:
- `@whiskeysockets/baileys` v7
- `express`
- `@supabase/supabase-js`
- `typescript`
- `pino` (logging)

### 🔄 Migration Notes

#### For Existing Deployments
1. **Database**: No schema changes required
2. **Environment Variables**: No new variables needed
3. **Auth Files**: Will be preserved during updates
4. **Breaking Changes**: None - all changes are backward compatible

### 🎓 Learning & Improvements

#### What Worked Well
- Incremental deployment approach
- Comprehensive logging for debugging
- Fallback mechanisms (polling when SSE fails)
- User feedback loop for UI preferences

#### What Could Be Improved
- Avoid circular imports (learned the hard way)
- Better architecture planning before SSE implementation
- More thorough testing before deployment
- Consider event emitter pattern from the start

---

## Version History

### v1.1.0 (Current) - 2025-01-23
- Real-time messaging infrastructure
- Session management improvements
- Message ordering fixes
- Image rendering fixes
- UI/UX improvements

### v1.0.0 - 2025-01-22
- Initial release
- Multi-tenant WhatsApp sessions
- Message sending (text, images, videos, documents)
- QR code authentication
- Basic dashboard UI

---

## Contributors

- Niccolò Basilico (@niccolobasilico) - Project Owner
- Claude (Anthropic) - Development Assistant

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/niccolobasilico/whatsapp-microservice/issues
- Documentation: See README.md and other docs in repository

---

**Last Updated**: 2025-01-23
