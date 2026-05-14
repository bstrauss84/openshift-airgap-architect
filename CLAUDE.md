# OpenShift Airgap Architect - AI Agent Instructions

**Purpose:** This file establishes the documentation hierarchy and authority for AI agents working on this codebase.

---

## Documentation Hierarchy (Single Source of Truth)

### 1. Canonical Status Registry: `/docs/BACKLOG_STATUS.md`

**Authority:** Single source of truth for ALL status claims  
**Items:** DOC-001 through DOC-056+  
**Purpose:** Evidence-first reconciliation of all work completed, in progress, and planned

**Before making status claims:**
1. Check `/docs/BACKLOG_STATUS.md` first
2. Provide code/commit evidence for any updates
3. Use canonical status vocabulary ONLY (see below)
4. If updating status, add a row to the BACKLOG_STATUS.md table with evidence

**Status vocabulary (canonical):**
- `active`: planned and in-scope
- `deferred`: intentionally postponed
- `blocked`: cannot progress until blocker resolved
- `done_pending_verification`: implemented, verification incomplete
- `verified_done`: implemented and verified against code/tests
- `obsolete`: no longer relevant
- `superseded`: replaced by another item

**Priority vocabulary:**
- `p0`: urgent correctness/security impact
- `p1`: high product impact
- `p2`: normal planned work
- `p3`: low-priority improvement

### 2. Active Execution Plan: `/docs/REVISED_PHASED_PLAN_2026-05-10.md`

**Authority:** Current phased implementation roadmap  
**Created:** 2026-05-10 (after systematic backlog review)  
**Current Phase:** Phase 0 (Quick Wins & Foundation) - 75% complete  
**Purpose:** Clean, actionable phases based on verified backlog status and user priorities

**What it contains:**
- 8 phases with clear sequencing (Phase 0 through Phase 7 + exploratory)
- Dependencies and parallelization opportunities
- Estimated timelines (5-8 months total)
- Success criteria per phase
- Risk mitigation strategies

**When to update:**
- Mark items complete as they finish (with dates + commit evidence)
- Update phase completion percentages
- Track remaining items in each phase
- Cross-reference BACKLOG_STATUS.md for detailed status

**Current focus:** Finish Phase 0 (3 remaining items), then start Phase 2A (YAML Drawer)

### 3. Historical Work Plan: `/docs/COMPREHENSIVE_MASTER_PLAN.md`

**Authority:** Detailed historical phase/batch tracking (Phases 1-2 tooltip work)  
**Status:** Phases 1-2 COMPLETE (100% tooltip coverage)  
**Purpose:** Reference for tooltip standards and completed tooltip expansion work

**Use for:**
- Tooltip formatting standards (gold standard reference)
- Historical batch completion tracking
- Quality checklist for FieldLabelWithInfo components
- Evidence of Phases 1-2 completion

**Do NOT use for:** Current work planning (use REVISED_PHASED_PLAN instead)

### 4. Local Backlog: `/LOCAL_BACKLOG.md` (not committed)

**Authority:** User's personal tracking (in .gitignore)  
**Purpose:** Lower-priority items, experimental work, deferred features  
**Scope:** NOT canonical - check BACKLOG_STATUS.md for any claims

---

## Evidence Requirements

For any status update to BACKLOG_STATUS.md:

**Required fields:**
1. **Commit SHA** or **file path** - Concrete code evidence
2. **Test files** - Link to passing tests (if applicable)
3. **Source documentation** - Reference planning docs or user requests
4. **Next action** - What remains if not `verified_done`

**Example row:**
```markdown
| DOC-049 | Comprehensive Tooltip Expansion | verified_done | p1 | `docs/COMPREHENSIVE_MASTER_PLAN.md` | Commits 0e3fe69-596fc2a, `frontend/tests/hint-syntax.test.js` passing | Tooltip expansion complete. |
```

---

## Work Session Protocol

### At End of Work Session

1. **Update docs/COMPREHENSIVE_MASTER_PLAN.md progress (if tooltip work)**
   - Mark completed phases/batches
   - Update completion percentages
   - Add completion dates

2. **Add completed items to docs/BACKLOG_STATUS.md with evidence**
   - Follow canonical status vocabulary
   - Provide commit SHAs or file paths
   - Link to tests if applicable

3. **Archive session notes to `.archive/session-notes-YYYY-MM-DD/`**
   - Move temporary working files
   - Delete `.bak` files
   - Create README.md index in archive directory

4. **Update this file if patterns change**
   - New documentation files added
   - Authority structure changes
   - Process improvements discovered

---

## Tooltip Standards (Phases 1-2 Complete)

All FieldLabelWithInfo tooltips must use gold standard formatting:

### Required Format

```jsx
<FieldLabelWithInfo
  label="Field Name"
  hint={`Brief one-line description.

**What is this:**
Explanation of the concept or field purpose.

**When needed:**
Scenarios where this is required or optional.

**Format:**
Expected input format, data type, constraints.

**How it's used:**
Where this appears in generated configs or how it affects deployment.

**Important:**
⚠️ Critical warnings, immutability notes, security considerations.

**Example:**
Concrete real-world example values.`}
  required={isRequired}
>
```

### Quality Checklist

- ✅ Template literal syntax `{`...`}`
- ✅ **Bold** section headers (renders as yellow highlighting)
- ✅ Comprehensive WHAT/WHY/WHEN/FORMAT/EXAMPLE sections
- ✅ Beginner-friendly language, no unexplained jargon
- ✅ Real-world examples with actual values
- ✅ Security warnings (⚠️) where applicable
- ✅ Immutability noted ("cannot be changed after installation")

---

## File Organization

### Keep (Living Documents)
- `docs/BACKLOG_STATUS.md` - Canonical status registry (single source of truth)
- `docs/REVISED_PHASED_PLAN_2026-05-10.md` - **ACTIVE execution plan** (current work roadmap)
- `docs/COMPREHENSIVE_MASTER_PLAN.md` - Historical plan (Phases 1-2 tooltip work, quality standards)
- `LOCAL_BACKLOG.md` - User's personal backlog (not committed)
- `docs/TOOLTIP_EXPANSION_MASTER_PLAN.md` - Tooltip audit data reference
- `docs/SETUP_COMPLETE.md` - Catalog sync reference guide
- `UI_STANDARDS.md` - UI design and implementation standards
- `docs/CATALOG_SYNC_GUIDE.md` - Catalog synchronization procedures
- `docs/BACKLOG_REVIEW_2026-05-10.md` - Review summary that led to revised plan

### Archive (Session Notes)
Create `.archive/session-notes-YYYY-MM-DD/` directories for:
- Temporary working files
- Session status reports
- Audit findings
- Implementation notes

Include a README.md index listing all archived files.

### Delete (Temporary Artifacts)
- `.bak` files after validation
- Temporary test output
- Build artifacts not in `.gitignore`

---

## Git Workflow

### Commit Message Format

Follow existing patterns in the repository:

```
Brief summary (70 chars or less)

Optional longer description:
- Bullet points for multiple changes
- Reference DOC-XXX items when applicable
- Explain WHY not just WHAT

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Before Committing

1. Review git status and diff
2. Stage specific files (avoid `git add -A`)
3. Write meaningful commit message
4. Ensure tests pass
5. Check for sensitive data (.env, credentials)

### Branch Strategy

- **main:** Production-ready code
- **develop:** Active development (default target)
- Feature branches: For experimental work

---

## Testing Requirements

### Before Marking Work Complete

1. ✅ Frontend tests pass: `npm test`
2. ✅ Backend tests pass: `npm test` (backend directory)
3. ✅ Build succeeds: `npm run build`
4. ✅ No console errors in development mode
5. ✅ Validate tooltips render correctly (check UI)

### Test Coverage Expectations

- New features require tests
- Bug fixes should include regression tests
- UI changes: manual verification required
- API changes: integration tests required

---

## Common Pitfalls

### ❌ Don't Do This

1. **Don't claim work is complete without code evidence**
   - Bad: "I updated the tooltips" (no commit reference)
   - Good: "Updated tooltips in commit a1b2c3d, verified in UI"

2. **Don't use non-canonical status terms**
   - Bad: "mostly done", "in progress", "finished"
   - Good: `verified_done`, `done_pending_verification`, `active`

3. **Don't duplicate status claims across multiple docs**
   - Canonical status lives in docs/BACKLOG_STATUS.md only
   - Other docs reference it: "See DOC-049"

4. **Don't archive or delete living documents**
   - docs/COMPREHENSIVE_MASTER_PLAN.md is living historical reference, not session notes
   - Check this file before archiving anything

5. **Don't skip evidence when updating status**
   - Every status change needs commit SHA or file path
   - "It's done" without evidence is not acceptable

### ✅ Do This Instead

1. **Provide concrete evidence for all claims**
   - Link to specific commits
   - Reference test files
   - Point to lines of code

2. **Use canonical vocabulary consistently**
   - Learn the 6 status terms
   - Learn the 4 priority levels
   - Use them everywhere

3. **Keep docs/BACKLOG_STATUS.md as single source of truth**
   - Update it when work completes
   - Reference it from other docs
   - Check it before making claims

4. **Archive session notes, keep living docs**
   - Session-specific findings → archive
   - Ongoing tracking → living docs

5. **Always include next_action if not verified_done**
   - What remains to do
   - What blocks completion
   - What verification is needed

---

## Debugging Protocol: Systematic Over Clever

**See `.research/POSTMORTEM_WHY_I_FAILED.md` for detailed case study (2026-05-13 YAML bug)**

### Core Rule: After 2-3 Failed Fix Attempts

**STOP GUESSING. Start instrumenting.**

### The 6-Step Protocol

#### 1. Instrument FIRST, Fix SECOND
**Do this IMMEDIATELY (attempt #1 or #2):**
- Add comprehensive logging to ALL relevant code paths
- Log ALL conditional branches (which path taken + WHY)
- Log ALL early returns with the reason they're returning
- Log state snapshots before/after key operations
- Log request/response pairs with timing

**Don't:** Make educated guesses without evidence. Logs don't lie.

#### 2. Compare Working vs Broken Flows
**If something works in scenario A but not B:**
- Trace BOTH scenarios with logging enabled
- Ask user to test BOTH scenarios
- Compare logs side-by-side
- Find the exact divergence point
- Question WHY they diverge

**Don't:** Assume you know what's different. Prove it with logs.

#### 3. Question ALL Assumptions
**Guards and early returns are SUSPECTS, not givens:**
- "Why does this guard exist?"
- "What happens if I remove it?"
- "Is this guard necessary or redundant?"
- "Could this guard be CAUSING the bug?"

**Don't:** Assume existing code is correct. It might be the bug.

#### 4. Listen to User Frustration as Data
**When user says:**
- "Still broken" → Your analysis is wrong, start over
- "I don't see how..." → Your approach is flawed
- "Tired of guessing" → Need systematic approach
- "What is X doing that Y isn't?" → THIS IS THE KEY QUESTION

**Don't:** Treat frustration as noise. It's signal.

#### 5. Never Claim "Fixed" Without User Testing
**Language matters:**
- ✅ "This SHOULD fix it, please test"
- ✅ "If my analysis is correct, this will help"
- ✅ "Let's try this approach"
- ❌ "This is 100% fixed"
- ❌ "This is definitely the issue"
- ❌ "Smoking gun found"

**Don't:** Confuse confidence with correctness. Wait for confirmation.

#### 6. Use Plan Mode After 2-3 Failures
**Signals need for systematic investigation:**
- Forces comprehensive exploration
- Prevents guess-and-check loops
- Gets user buy-in for thorough approach
- Use parallel agents to investigate independently

**Don't:** Keep guessing for 10+ attempts. That's the definition of insanity.

### Red Flags That You're Off Track

- ❌ Claiming "fixed" multiple times
- ❌ Finding 40+ "smoking guns" but nothing works
- ❌ User frustration increasing
- ❌ Not comparing working vs broken flows
- ❌ Guessing at root cause without evidence
- ❌ Adding logging too late (attempt #8+)
- ❌ Assuming guards/early returns are correct

### Why This Matters

**Real example (2026-05-13):**
- Bug: One line `if (!showPreview) return;` blocking YAML generation
- Attempts: 10+ failed guesses (delays, POST vs GET, state closures)
- User clue: "what is show/hide doing that import isn't?" ← The answer was in this question
- Fix: Plan mode → systematic comparison → found guard → deleted 1 line → done
- Time wasted: Hours of guessing when logging would have shown it immediately

**Lesson:** Debugging is not about being clever. It's about being systematic.

---

## Questions?

If you're unsure about:
- **Status vocabulary:** Check BACKLOG_STATUS.md header
- **What to archive:** Check "File Organization" section above
- **Commit format:** Check git log for recent examples
- **Testing requirements:** Check "Testing Requirements" section above

**When in doubt:** Ask the user before making assumptions about:
- Status of incomplete work
- Whether to archive or keep a file
- Priority of new work
- Scope of a feature request

---

**Last Updated:** 2026-05-13  
**Revision:** Added Debugging Protocol section based on YAML bug postmortem, systematic debugging over guesswork
