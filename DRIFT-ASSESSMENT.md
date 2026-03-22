# Drift Assessment: OpenClaw Skill → Webapp

Comparison between the original `small-biz-finder` OpenClaw skill and the Altsearch webapp.

## Summary

**Capability drift:** Minor  
**Architecture drift:** Major (by design)  
**UX drift:** Significant improvement

The webapp preserved core functionality while adding real-time progress, better prompt engineering, and a standalone user interface. The skill was designed as a framework; the webapp is a production implementation.

---

## Core Functionality: ✅ Preserved

| Feature | Skill (Original) | Webapp (Current) | Status |
|---------|------------------|------------------|--------|
| Find small business alternatives | ✅ | ✅ | **Maintained** |
| Blocklist major retailers | ✅ | ✅ | **Maintained** |
| Location preference (soft) | ✅ | ✅ | **Maintained** |
| JSON result format | ✅ | ✅ | **Maintained** |
| Online ordering verification | ✅ | ✅ | **Maintained** |
| URL validation | ✅ | ✅ | **Maintained** |

---

## What Changed

### 1. Prompt Engineering: Evolved ✨

**Skill:** Simple template-based prompt  
**Webapp:** Sophisticated multi-stage with fuzzy result counts, AI self-assessment, honest summaries

**Impact:** Better results, fewer mediocre options, honest feedback when results are limited.

### 2. Search Strategy: Optimized ⚡

**Evolution:**
1. V1: 4 parallel searches → Rate limited
2. V2: 4 sequential with delays → Slow
3. V3: 1 comprehensive search → Fast ✅

**Impact:** Faster, more reliable, no rate limits.

### 3. Progress Feedback: Added 📊

**Skill:** None  
**Webapp:** SSE streaming with real-time updates (60-90s AI processing made visible)

**Impact:** Users tolerate long waits when they see progress.

### 4. Blocklist UX: Enhanced 🎛️

**Skill:** Config file  
**Webapp:** Visual editor with click-to-remove, inline additions

**Impact:** Non-technical users can customize.

### 5. Category Presets: Removed 🗑️

**Skill:** Predefined blocklists (pet_supplies, electronics, food)  
**Webapp:** Fully customizable blocklist only

**Reasoning:** Simpler, more flexible.

### 6. Result Format: Enriched 📝

**Added:** `summary`, `quality`, `distance_miles`, `is_chain`

**Impact:** Richer metadata, better UX.

### 7. Architecture: Completely Different 🏗️

**Skill:** OpenClaw framework  
**Webapp:** Cloudflare Workers + Next.js + Vercel

**Impact:** Standalone, public-facing, no OpenClaw dependency.

### 8. Accessibility: Added ♿

Semantic HTML, ARIA attributes, keyboard navigation, screen reader support.

### 9. Error Handling: More Detailed ⚠️

Specific errors, visual display, graceful degradation, progress bar caps at 98%.

---

## What Was Lost

1. **Category Presets** - Could add back as UI feature
2. **OpenClaw Integration** - Intentional (standalone webapp)
3. **Model Flexibility** - Hardcoded to free tier

---

## Lessons Learned

### What the Skill Got Right ✅

- Soft location preference
- Blocklist approach
- JSON format
- URL verification emphasis

### What the Webapp Improved ✨

- Fuzzy AI guidelines ("5-15 based on quality")
- Progress visibility (SSE)
- Honest AI feedback (summary + quality)
- Single comprehensive search
- Visual blocklist editor

### What Could Be Better 🤔

- Category presets (optional)
- Result caching
- User accounts
- Services support (currently fails for "plumber")

---

## Drift Classification

### 🟢 Core Capabilities: Preserved
All essential features work ✅

### 🟡 UX: Significantly Improved
Real-time progress, visual editor, accessibility

### 🟠 Prompt Engineering: Evolved
Fuzzy guidelines, self-assessment, better structure

### 🔴 Architecture: Completely Different
Intentional (goal: standalone webapp)

### ⚫ Removed Features
Category presets, OpenClaw integration, model flexibility

---

## Conclusion

**Drift assessment: Low**

The webapp preserved all core capabilities while adding significant UX improvements. The only "drift" is architectural (standalone vs OpenClaw skill), which was the goal.

The skill was a framework. The webapp is the implementation.
