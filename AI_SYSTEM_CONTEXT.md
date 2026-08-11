# Thi Online - AI System Context

Last updated: 2026-04-04

This file is the single briefing document for future AI agents and developers working on this repository. If an AI needs to understand the system before making changes, it should read this file first, then inspect only the files related to the requested change.

## 1. Purpose Of The Product

Thi Online is a React + Firebase online exam platform with three main roles:

- Super admin: operates the platform, approves teachers, manages taxonomy, publishes shared content, builds the system question bank, reviews teacher submissions, monitors package usage, and maintains internal playbooks.
- Teacher: creates/imports exams, manages students, opens exams, reviews results, uses the question bank, imports shared exams, can run live quiz rooms, and can optionally use BYOK AI assistance.
- Student: joins a teacher's class, takes exams, views results, participates in live quiz sessions, and tracks personal progress.

The current product is not just a quiz app. It is evolving into a teacher-facing SaaS with:

- private teacher exam authoring,
- a system-wide admin-controlled question bank,
- a shared exam library,
- moderation workflows,
- package-based subject/grade access control,
- a dedicated Teaching Studio hub for games, teaching tools, smart content, and reusable templates,
- premium admin operations surfaces,
- and optional BYOK AI support.

Live production project:

- Firebase project: thi-online-nhc
- Hosting URL: https://thi-online-nhc.web.app

## 2. How Future AI Should Use This File

Before editing anything:

1. Read Sections 3 through 10 of this file.
2. If the task touches auth or permissions, also read AuthContext, App routes, and firestore.rules.
3. If the task touches exam import, also read UploadExamPage and the parser utilities.
4. If the task touches package access or the shared/system catalog, also read teacherCatalogAccess plus AdminDashboard, TeacherDashboard, QuestionBankPage, UploadExamPage, and ExamDetailPage.
5. If the task touches statistics or usage, also read functions/index.js.

After any meaningful architecture change, this file should be updated. The file is intended to remain the fastest high-signal entry point into the system.

## 3. Technology Stack

Frontend:

- React 19
- Vite 8
- React Router 7
- Framer Motion
- SweetAlert2
- Bootstrap Icons
- KaTeX for math rendering

Backend and platform:

- Firebase Auth
- Firestore
- Firebase Cloud Functions v2
- Firebase Storage
- Firebase Hosting

Auxiliary tooling:

- JSZip for DOCX parsing
- XLSX for Excel import/export
- A standalone Cloud Run style Pandoc service exists in cloud-run-pandoc/

Important note about AI support:

- AI is BYOK. API keys are stored only in the browser localStorage of the current machine.
- Keys are not stored in Firestore.

Important note about document import:

- The current main frontend import flow is client-side.
- The cloud-run-pandoc service exists in the repo, but the current src/ code does not appear to call it directly.
- Treat that service as an auxiliary or future-ready service, not the primary import path unless wired in later.

## 4. Repository Map

Top-level important files and folders:

| Path | Purpose |
| --- | --- |
| package.json | Frontend package config and scripts |
| firebase.json | Hosting, Firestore, Functions, Storage config |
| firestore.rules | Firestore access control |
| firestore.indexes.json | Firestore composite indexes |
| storage.rules | Storage access control |
| functions/index.js | Cloud Functions and Firestore trigger automations |
| cloud-run-pandoc/ | Separate Python service for Pandoc-based DOCX parsing |
| src/App.jsx | Route map and protected route policy |
| src/firebase.js | Firebase SDK initialization |
| src/contexts/AuthContext.jsx | Auth/session/profile bootstrap |
| src/pages/ | Main UI surfaces |
| src/utils/ | Business logic, parsing, scoring, publishing, stats helpers |
| src/styles/app.css | Main styling system |

Most important page files:

| File | Responsibility |
| --- | --- |
| src/pages/LoginPage.jsx | Login, teacher registration request flow |
| src/pages/AdminDashboard.jsx | Super admin control room |
| src/pages/TeacherDashboard.jsx | Teacher home, exams, students, shared/sample library, settings |
| src/pages/TeachingStudioPage.jsx | Dedicated teacher tool hub for games, toolkit, AI lab, and template vault |
| src/pages/UploadExamPage.jsx | Create/import exams from files or manual authoring |
| src/pages/ExamDetailPage.jsx | Full exam editor, bank sync, library/system publishing, AI question assistant |
| src/pages/QuestionBankPage.jsx | Teacher/admin question bank surface |
| src/pages/StudentDashboard.jsx | Student home, available exams, leaderboard, live join |
| src/pages/QuizPage.jsx | Student exam experience, anti-cheat, submission |
| src/pages/ResultPage.jsx | Post-quiz result screen |
| src/pages/ExamSessionsPage.jsx | Teacher results review and export |
| src/pages/CertificateVerifyPage.jsx | Public verification screen for exported commendation/confirmation documents |
| src/pages/TeacherPortal.jsx | Public teacher landing page via slug |
| src/pages/LiveClassroomPage.jsx | Teacher live quiz room controller |
| src/pages/LiveStudentPage.jsx | Student live quiz participant screen |
| src/pages/TeacherStudentDetailPage.jsx | Teacher view of one student |

Most important utility files:

| File | Responsibility |
| --- | --- |
| src/utils/teacherCatalogAccess.js | Subject/grade package logic |
| src/utils/library.js | Shared library publish/import and built-in sample import |
| src/utils/bank.js | Private/system bank sync operations |
| src/utils/bankModeration.js | Teacher submission to moderation and admin approval |
| src/utils/taxonomy.js | Subject/grade config loading and saving |
| src/utils/adminPlaybook.js | Private admin operational playbook persistence |
| src/utils/importParsers.js | File import entry point |
| src/utils/docxParser.js | Client-side DOCX parsing |
| src/utils/examScoring.js and src/utils/scoring.js | Scoring logic |
| src/utils/importQuality.js | Import shield, warnings, safe activation decisions |
| src/utils/aiSettings.js | BYOK AI settings and local usage accounting |
| src/utils/aiAuthoring.js | AI question drafting helper |
| src/utils/certificateExport.js | Certificate template selection, payload encoding, and verification URL helpers |
| src/utils/studentAccess.js | Student blocked/expired state logic |
| src/utils/starterExam.js | Seed starter exam for brand-new teachers |

## 5. Route Map

Main routes from src/App.jsx:

| Route | Audience | Purpose |
| --- | --- | --- |
| /login | Public | Login and teacher registration request |
| /t/:slug | Public + signed-in student | Public teacher portal |
| /admin | Admin only | Super admin dashboard |
| /teacher | Teacher and admin | Teacher dashboard |
| /teacher/studio | Teacher and admin | Teaching Studio hub |
| /teacher/upload | Teacher and admin | Create/import exam |
| /teacher/exam/:examId | Teacher and admin | Edit an exam |
| /teacher/exam/:examId/sessions | Teacher only | Review exam results |
| /teacher/exam/:examId/live | Teacher and admin | Run live classroom quiz |
| /teacher/bank | Teacher and admin | Question bank |
| /teacher/student/:studentId | Teacher only | Student detail |
| /teacher/student/:studentId/preview | Teacher only | Preview student dashboard |
| /teacher/student/:studentId/preview/quiz/:examId | Teacher only | Preview quiz as that student |
| /teacher/student/:studentId/preview/result/:sessionId | Teacher only | Preview result as that student |
| /student | Student | Student dashboard |
| /student/quiz/:examId | Student | Take exam |
| /student/result/:sessionId | Student | View result |
| /certificate/verify | Public | Verify exported certificate payload from QR or direct link |
| /live/:code | Student | Join live quiz room |

Important route behavior:

- Admin is allowed into many teacher routes by ProtectedRoute.
- Some teacher pages explicitly set allowAdmin to false, for example exam sessions and teacher student detail.
- Navbar is hidden on quiz and live routes.

## 6. Role Model And Authentication

Auth flow is centered in src/contexts/AuthContext.jsx.

Key behaviors:

- Google sign-in is used.
- On first sign-in, a users/{uid} profile is created automatically.
- Default new role is student.
- If the signed-in email matches VITE_ADMIN_EMAIL, the profile is auto-promoted to admin.

Role values currently observed:

- admin
- teacher
- pending_teacher
- student

Teacher onboarding flow:

1. User signs in and becomes student by default.
2. On the login page, the user can request teacher access.
3. The profile is updated to pending_teacher.
4. Admin approves or rejects the request from AdminDashboard.
5. On approval, the user becomes teacher, gets a teacherSlug, subscription status, and a default catalog access package.

Student access model:

- Students are logically attached to a teacher mainly through users.teacherId.
- Optional student lock state is stored in blocked.
- Optional class access expiry is stored in teacherExpiry.
- studentAccess.js translates these fields into user-facing states like blocked and expired.

## 7. Firestore Data Model

The system is heavily Firestore-driven. The collections below are the important ones.

### 7.1 users

Purpose:

- Master profile for every signed-in person.

Important fields:

- role
- email, displayName, photoURL
- teacherId, teacherName
- pendingTeacherId, pendingTeacherName
- teacherSlug
- schoolName
- teacherStatus
- subscriptionEnd, subscriptionMonths
- blocked
- teacherExpiry
- accessPackageType
- accessPackageLabel
- approvedSubjects
- approvedGrades
- approvedAccessPairs
- catalogPairCount
- searchKeywords and normalized search helper fields

Notes:

- This document drives authorization decisions in rules.
- The same collection stores admin, teacher, and student profiles.

### 7.2 exams

Purpose:

- Editable exam source documents owned by one teacher/admin.

Important fields:

- title, subject, grade
- teacherId, teacherName
- status: draft or active
- duration, maxAttempts
- shuffleQuestions, shuffleChoices, showResult
- antiCheat
- gamification
- sourceFormat, sourceLabel
- importQuality
- importHistory
- assetRefs, assetSummary
- bankSyncEnabled
- sharedPublished, sharedExamId, sharedPublishedAt
- systemBankPublished, systemBankPublishedAt, systemBankPublishedBy

Subcollection:

- exams/{examId}/questions

Question docs contain:

- type
- content_text, content_html
- choices
- correct_answer
- explanation, explanation_html
- points
- section metadata for grouped reading/English style sections

Important invariant:

- exams is the editable source of truth for a teacher's working exam.

### 7.3 sessions

Purpose:

- One student submission attempt.

Important fields:

- examId, examTitle
- teacherId, teacherName
- studentId, studentName, studentEmail
- score, total
- autoGradedScore, autoGradedTotal
- totalPoints, manualTotalPoints, manualReviewPending
- timeSpent
- answers
- submissionAssetRefs
- retentionCleanupAt
- antiCheat
- gameMeta
- submitReason, autoSubmitted
- startedAt, completedAt

Notes:

- Functions use this collection to keep teacherStats and examStats updated.
- Essay answers can now include uploaded image attachments stored separately in Firebase Storage and referenced from session answers.
- Student submission data is intended to be retained for at most 3 years before scheduled cleanup removes both session docs and attached submission images.

### 7.4 bankItems

Purpose:

- Question-level bank storage.

Scopes:

- private: teacher-owned question bank
- system: admin-owned global system bank

Important fields:

- scope
- ownerId, ownerName for private bank rows
- sourceExamId, sourceExamTitle
- sourceQuestionId
- subject, grade, chapter, difficulty
- content and answer fields copied from question docs

Important invariant:

- bankItems is question-granular.
- It is not the same thing as sharedExams.

### 7.5 sharedExams

Purpose:

- Complete exam templates published for teachers to import into their own account.

Important fields:

- title, subject, grade
- duration, questionCount, maxAttempts
- shuffleQuestions, shuffleChoices, showResult
- antiCheat, gamification
- ownerAdminId, ownerAdminName
- sourceExamId
- published
- importCount
- assetSummary

Subcollection:

- sharedExams/{sharedExamId}/questions

Important invariant:

- sharedExams is exam-granular.
- It is the finished exam library, not the system question bank.

### 7.6 bankSubmissions

Purpose:

- Moderation queue where teachers submit curated question sets for admin review.

Lifecycle statuses:

- pending
- approved
- rejected

Subcollection:

- bankSubmissions/{submissionId}/questions

On approval:

- Admin promotes the submission into sharedExams.

### 7.7 systemConfigs/taxonomy

Purpose:

- Global subject and grade configuration.

Fields:

- subjects[]
- grades[]
- updatedAt, updatedBy, updatedByName

This config feeds:

- admin taxonomy management,
- teacher subject/grade dropdowns,
- catalog package restriction logic.

### 7.8 teacherStats, examStats, studentStats

Purpose:

- Pre-aggregated usage and result metrics for dashboards and admin analytics.

These are maintained mostly by Cloud Functions triggers, not manually by frontend code.

### 7.9 adminPlaybooks

Purpose:

- Private operational notes for the super admin.

Stored at:

- adminPlaybooks/{adminUid}

Fields currently include:

- collectionMap
- dailyWorkflow
- subjectLockPlan
- privateNotes
- updatedAt, updatedBy, updatedByName

### 7.10 liveRooms

Purpose:

- Real-time live quiz room state.

Observed fields in frontend:

- examId, examTitle
- teacherId, teacherName
- mode
- questionDuration
- status
- currentQIdx
- questions
- participants
- scores
- answers
- eliminated
- createdAt, expiresAt

Important caution:

- Frontend code uses liveRooms heavily.
- Current firestore.rules does not appear to contain an explicit liveRooms rule block.
- This should be treated as a current security or production-verification gap.

### 7.11 auditLogs

Purpose:

- Operational trail for teacher/admin actions.

Frontend uses it for important actions such as approvals, suspension, bank publishing, moderation actions, and student management.

### 7.12 classes and enrollments

Purpose:

- Lightweight supporting collections for class membership patterns.

Important note:

- The dominant student-teacher relationship in the current product is still users.teacherId.
- classes and enrollments exist, but they are not the main axis of the current app architecture.

## 8. Core Content Architecture

This is the most important conceptual model in the system.

There are four different content layers:

1. exams
   - Teacher/admin editable source exams.
   - This is where authoring and detailed editing happen.

2. bankItems
   - Question bank rows.
   - private scope is teacher-owned.
   - system scope is admin-owned and globally reusable.

3. sharedExams
   - Full exam templates published by admin.
   - Teachers import these into their own draft exams.

4. bankSubmissions
   - Queue of teacher-submitted content for admin moderation.

If future AI gets confused, the shortcut is:

- exams = editable working exams
- bankItems = reusable single questions
- sharedExams = reusable full exams
- bankSubmissions = moderation intake

## 9. Package And Catalog Access Model

The system now includes a package-based subject/grade access model for teachers.

Central logic lives in:

- src/utils/teacherCatalogAccess.js

Supported package types:

- full_catalog
- single_subject
- multi_subject
- custom

Stored on user profiles:

- accessPackageType
- accessPackageLabel
- approvedSubjects
- approvedGrades
- approvedAccessPairs
- catalogPairCount

Important business behavior:

- Legacy teachers without accessPackageType are treated as full-access teachers.
- Restricted teachers only see system bank and shared library content whose subject and grade match the assigned package.
- Missing subject or grade metadata on system/shared content becomes a real business problem because restricted teachers will not see those items.

Where this logic is used:

- AdminDashboard configures packages.
- TeacherDashboard filters shared library access.
- QuestionBankPage filters system bank access.
- UploadExamPage restricts subject/grade choices.
- ExamDetailPage prevents saving out-of-package subject/grade values.
- firestore.rules enforces the same restrictions on the backend.

Current admin tooling around this model:

- package assignment UI,
- private admin playbook,
- package analytics,
- catalog hygiene warnings for missing subject/grade metadata.

## 10. Main Product Flows

### 10.1 Login And Teacher Approval

1. User signs in with Google.
2. AuthContext creates or loads users/{uid}.
3. Student may request teacher access from LoginPage.
4. Admin approves the teacher from AdminDashboard.
5. Approval writes role, subscription, teacherSlug, and default full catalog access.

### 10.2 Teacher First-Time Experience

TeacherDashboard seeds a starter exam once for a brand-new teacher:

- only when stats.total is 0,
- only if starterExamSeeded is not set,
- only for non-admin teacher view.

Starter exam logic lives in:

- src/utils/starterExam.js

### 10.3 Exam Creation And Import

UploadExamPage supports:

- DOCX
- TXT
- MD treated like text import
- XLSX and XLS
- TEX and LaTeX
- JSON
- fully manual authoring

Import entry point:

- src/utils/importParsers.js

Current main parser behavior:

- DOCX is parsed client-side with JSZip in src/utils/docxParser.js.
- Excel is parsed client-side.
- LaTeX is parsed client-side.
- Text and Markdown use tron-de style parsing.
- JSON supports either a raw array or an object containing questions.

When saving an imported exam:

1. Images are uploaded to Firebase Storage under exams/{teacherId}/...
2. Data URLs in HTML are replaced with storage URLs.
3. Exam and question documents are created in Firestore.
4. importQuality and importHistory are stored.
5. bankSyncEnabled is set true for regular authored/imported exams.

### 10.4 Import Shield And Safe Activation

The system contains an import quality layer sometimes referred to in UI as Khiên nhập đề.

It is used to:

- detect malformed imported questions,
- store warning samples,
- block or warn before activation,
- record teacher review state.

Important consequence:

- A teacher can save a draft with issues.
- But activation may be blocked or require confirmation depending on import quality.

### 10.5 Exam Editing

ExamDetailPage is the main editing surface.

It supports:

- settings update,
- question editing,
- image insertion,
- math authoring with KaTeX-compatible LaTeX,
- scoring configuration,
- anti-cheat configuration,
- gamification configuration,
- publishing to shared library,
- publishing to system bank,
- rescore operations,
- delete operations,
- AI question assistance.

Important publishing behavior:

- sharedPublished controls publishing into sharedExams.
- systemBankPublished controls publishing a snapshot into bankItems scope=system.
- Private bank syncing is controlled by bankSyncEnabled.

### 10.6 Shared Library And Built-In Sample Library

There are two distinct teacher-importable sources:

1. sharedExams
   - admin-published real library content from Firestore.

2. BUILT_IN_SAMPLE_EXAMS
   - hard-coded built-in sample exams from src/utils/sampleLibrary.js.

Important note:

- Built-in samples are separate from sharedExams.
- They are useful onboarding content, but they are not managed via Firestore the same way sharedExams is.

### 10.7 Question Bank Flow

QuestionBankPage loads:

- teacher private bank from bankItems owned by the teacher,
- system bank from bankItems scope=system,
- or a restricted subset of the system bank based on catalog package.

Teachers can also:

- edit chapter and difficulty on bank items,
- create a new exam from selected bank questions,
- sync older exams into the private bank.

### 10.8 Moderation Flow

Teacher side:

- Selected bank content can be submitted to bankSubmissions.

Admin side:

- Admin reviews pending submissions.
- Approved submissions are converted into sharedExams.
- Rejected submissions remain part of the moderation history.

Important invariant:

- Moderation currently promotes into sharedExams, not directly into the system question bank.

### 10.9 Student Exam Flow

StudentDashboard loads:

- active exams for the teacher,
- student results,
- sessions,
- classmates leaderboard data.

QuizPage flow:

1. Student opens /student/quiz/:examId.
2. Frontend calls the callable function getQuizLaunchData.
3. Function verifies user role, class ownership, active exam, blocked state, and expiry.
4. Function returns question payload and current attempt count.
5. Frontend applies question/choice shuffling and anti-cheat logic.
6. On submit, a sessions document is created.
7. Student aggregate stats on the user document are updated.

Certificate export behavior:

- QuizPage and TeacherStudentDetailPage can both open src/components/Certificate.jsx for export.
- The export flow supports two document modes: commendation and confirmation.
- Theme/template state is remembered per teacher in localStorage.
- src/utils/certificateExport.js builds the display payload, encoded URL, and QR destination.
- /certificate/verify is a public page that decodes the embedded payload and renders a verification view.

Important certificate limitation:

- The current verification flow is presentation-level only.
- There is no Firestore-backed certificate registry, signature, or server-side authenticity check yet.
- Future work must not assume the QR payload is tamper-proof just because it opens a verify page.

Important reason the callable exists:

- It fixes security and access control at launch time.
- It centralizes attempt-count checks.

Important essay workflow note:

- Essay questions can now be answered with typed text, math snippets, and uploaded/chụp ảnh bài làm.
- The current product decision is still manual grading outside the system: teachers export a compact PDF containing the full exam plus each student's answers and then self-grade/self-total externally.
- The system does not attempt to write manual essay scores back into sessions in this workflow.

### 10.10 Live Classroom Flow

Teacher side:

- LiveClassroomPage loads an exam.
- Teacher creates a liveRooms document with room state and questions.
- Teacher advances phases through lobby, question, reveal, leaderboard, and ended.

Student side:

- LiveStudentPage subscribes to the liveRooms document.
- Student joins the room, submits answers, sees score changes and elimination state.

Current caution:

- Verify Firestore rules and production behavior carefully before extending this feature.
- The collection is used in code, but explicit rules were not found in the current rules file.

## 11. AI Authoring Model

AI support is intentionally BYOK and local-only.

Settings UI:

- src/components/AISettingsPanel.jsx

Where it appears:

- TeacherDashboard
- AdminDashboard

Supported providers now:

- Gemini
- Groq
- DeepSeek

How it works:

- Provider choice, API key, daily limits, monthly budgets, and per-provider budgets are stored in localStorage.
- requestQuestionAIDraft sends prompts directly from the browser to the chosen provider.
- Usage cost is only estimated locally.

Important security/product note:

- This is not a centralized server-side AI integration.
- Each teacher/admin uses their own key on their own browser.
- Switching browsers or machines loses the saved key.

AI question assistant usage:

- The main editing integration is in ExamDetailPage.
- Supported actions include generate, improve, remix, and explain.
- Returned content must be normalized into the internal question schema.

## 12. Parsing, Math, And Rich Content

Math and formatting:

- KaTeX is used to render LaTeX in content.
- OMML from Word is converted to LaTeX by src/utils/ommlToLatex.js.
- src/utils/math.js contains insertion helpers and wrap modes.

DOCX specifics:

- src/utils/docxParser.js extracts paragraphs, images, OMML math, inline formatting, and question structure.
- It supports grouped reading/English style sections through section tags.

Cloud Run Pandoc service:

- cloud-run-pandoc/app.py exposes a /convert endpoint for DOCX to question extraction using Pandoc AST.
- It can extract questions and images.
- Current src/ code does not appear to call this endpoint.
- Treat it as an available service or fallback path, not the default active parser.

## 13. Cloud Functions And Automations

Functions live in functions/index.js.

Observed deployed functions:

- syncTeacherProfileStats
  - Triggered on users/{userId} writes.
  - Maintains teacherStats student counts and teacher metadata.

- syncExamAggregates
  - Triggered on exams/{examId} writes.
  - Maintains examStats and teacherStats deltas.
  - Also cleans removed storage asset paths.

- syncSharedLibraryAggregates
  - Triggered on sharedExams/{sharedExamId} writes.
  - Maintains shared exam counts for the owner admin.

- syncSessionAggregates
  - Triggered on sessions/{sessionId} writes.
  - Maintains teacherStats and examStats session metrics.

- getQuizLaunchData
  - Callable.
  - Validates student or preview access before launching a quiz.

- adminRebuildUsageStats
  - Callable.
  - Rebuilds usage stats for one teacher or all teachers.

- cleanupExpiredSessions
  - Scheduled.
  - Deletes sessions older than 3 years and cleans related submission image objects from Storage.

Important note:

- The app depends on trigger-maintained aggregates. If future changes bypass these assumptions, dashboards may drift.

## 14. Security Model

Security is split between frontend route gating and Firestore/Storage rules.

### 14.1 Firestore Rules Highlights

From firestore.rules:

- users
  - Users can read their own profile.
  - Admin can manage teacher and pending teacher profiles.
  - Teachers can read/manage students attached to them.
  - Teacher public portal works because teacher docs with teacherSlug are readable.

- exams
  - Active exams are readable.
  - Signed-in owner teachers can read/write their own exams.
  - Students can read exams belonging to their teacher.

- exam questions
  - Students can read only when the exam is active, belongs to their teacher, and they are not blocked or expired.

- sessions
  - Readable by admin, the teacher, or the student who owns the session.
  - Students create their own sessions.

- bankItems
  - private scope is owner-only.
  - system scope is controlled by admin or package-based taxonomy access.

- sharedExams
  - Readable only when published and allowed by package taxonomy access.
  - Writable only by the owning admin.

- bankSubmissions
  - Teacher can create their own pending submissions.
  - Admin can review and update them.

- adminPlaybooks
  - Private to the owning signed-in admin.

- systemConfigs
  - Readable by teacher/admin.
  - Writable only by admin.

### 14.2 Storage Rules Highlights

Storage paths are under:

- exams/{teacherId}/{allPaths}
- submissions/{teacherId}/{examId}/{studentId}/{sessionId}/{allPaths}

Allowed reads:

- admin,
- the exam owner teacher,
- students attached to that teacher,
- admin-owned paths.

Allowed writes:

- admin,
- or the teacher/admin owning the path.

Submission storage behavior:

- Student essay images are stored under submissions/... with strict image-only and size-limited writes.
- Read access is restricted to the owning student, the teacher who owns the exam, and admin.

### 14.3 Important Security Caveat

Admin route access is broader than Firestore exam read access.

Practical effect:

- Admin can navigate to some teacher surfaces from the router.
- But rules still do not grant admin universal read access to all exam docs.
- This is why some admin analytics were built using system bank and shared library scans instead of scanning all source exams.

## 15. Firestore Indexes That Matter

Notable indexes from firestore.indexes.json:

- exams by teacherId and createdAt
- exams by teacherId, status, createdAt
- exams by teacherId, searchKeywords, createdAt
- sessions by studentId or examId
- users by teacherId, role, displayNameLower
- teacherStats by searchKeywords and updatedAt
- sharedExams by published and updatedAt
- sharedExams by published, subject, grade
- bankItems by scope, subject, grade
- bankSubmissions by submitterTeacherId or status and submittedAt

Important extension rule:

- If future work introduces new combined where/orderBy query patterns, update indexes together with UI code.

## 16. Operational Surfaces

### 16.1 AdminDashboard

Current admin dashboard responsibilities include:

- approve/reject/suspend/extend teachers,
- configure catalog access packages,
- manage taxonomy,
- review moderation submissions,
- use internal operational playbook,
- view package analytics and catalog hygiene,
- trigger usage stat rebuild,
- manage AI BYOK settings locally.

Two high-value recent admin surfaces:

- So do van hanh
  - private operational notes for the super admin.

- Goi va Kho
  - package distribution analytics,
  - system/shared metadata hygiene warnings,
  - visibility into what is actually being sold and what content is dirty.

### 16.2 TeacherDashboard

Current teacher dashboard responsibilities include:

- exam list,
- student list and pending join requests,
- entry point into the dedicated Teaching Studio route,
- shared library access,
- built-in sample library import,
- settings such as slug and school,
- AI BYOK settings,
- starter exam seeding for new teachers.

## 17. Development And Deployment

Frontend scripts from package.json:

- npm run dev
- npm run build
- npm run lint
- npm run preview

Functions runtime:

- Node 22

Common deployment commands used in this repo:

- firebase deploy --only hosting --project thi-online-nhc
- firebase deploy --only firestore:rules,firestore:indexes --project thi-online-nhc
- firebase deploy --only storage --project thi-online-nhc

Important config files:

- firebase.json
- firestore.rules
- firestore.indexes.json
- storage.rules

Cloud Run Pandoc service:

- Located in cloud-run-pandoc/
- Python app with a Dockerfile
- Appears deployable separately from the Firebase app

## 18. Known Constraints, Risks, And Current Gaps

These points matter for future development.

1. README.md is outdated.
   - It still contains the default Vite template and should not be treated as project documentation.

2. liveRooms rules gap.
   - Frontend uses liveRooms, but explicit Firestore rules for that collection were not found in the current rules file.
   - Verify before expanding live quiz functionality.

3. Admin exam-read limitation.
   - Admin does not appear to have universal source exam read access under current rules.
   - Some admin analytics intentionally use bankItems and sharedExams instead of exams for this reason.

4. Cloud Run Pandoc is present but not obviously wired into the current frontend path.
   - Avoid assuming it is active unless you explicitly connect it.

5. Package access depends on metadata hygiene.
   - Missing subject or grade in bankItems scope=system or sharedExams can make content invisible to restricted teachers.

6. Legacy full-access teachers still exist conceptually.
   - Teachers without accessPackageType are treated as full catalog access users for backward compatibility.

7. AI config is per-browser, not global.
   - A teacher changing devices will not carry over their AI keys or usage counters.

8. Aggregate stats are trigger-based.
   - If data is backfilled or mutated unusually, adminRebuildUsageStats may be needed.

## 19. Safe Extension Checklist

When changing major areas, update all dependent layers.

If changing auth or role behavior, check all of:

- src/contexts/AuthContext.jsx
- src/App.jsx
- firestore.rules
- functions/index.js
- any role-based UI text on LoginPage, TeacherDashboard, AdminDashboard, StudentDashboard

If changing subject or grade behavior, check all of:

- src/utils/taxonomy.js
- src/utils/teacherCatalogAccess.js
- src/pages/AdminDashboard.jsx
- src/pages/TeacherDashboard.jsx
- src/pages/QuestionBankPage.jsx
- src/pages/UploadExamPage.jsx
- src/pages/ExamDetailPage.jsx
- firestore.rules
- firestore.indexes.json

If changing exam schema or question schema, check all of:

- UploadExamPage
- ExamDetailPage
- QuestionBankPage
- library.js
- bank.js
- bankModeration.js
- parser utilities
- scoring utilities
- functions/index.js aggregations if new fields affect metrics

If changing import pipeline, check all of:

- src/utils/importParsers.js
- src/utils/docxParser.js
- src/utils/excelParser.js
- src/utils/texParser.js
- src/utils/importQuality.js
- UploadExamPage
- ExamDetailPage import history and review surfaces

If changing shared library or system bank behavior, check all of:

- src/utils/library.js
- src/utils/bank.js
- src/utils/bankModeration.js
- src/pages/AdminDashboard.jsx
- src/pages/TeacherDashboard.jsx
- src/pages/QuestionBankPage.jsx
- src/pages/ExamDetailPage.jsx
- firestore.rules
- firestore.indexes.json

## 20. Suggested Prompt For Future AI

Use a prompt like this when asking another AI to continue development:

"Read AI_SYSTEM_CONTEXT.md first. Then inspect only the files related to this task. Do not assume README is accurate. If the task touches permissions, also inspect firestore.rules and functions/index.js before proposing changes."

## 21. Final Mental Model

If you only remember one short summary, remember this:

- Auth and roles live in users and AuthContext.
- Editable teaching content lives in exams and question subcollections.
- Reusable questions live in bankItems.
- Reusable full exams live in sharedExams.
- Teacher contributions flow through bankSubmissions.
- Subject/grade packages control what restricted teachers can see.
- Firestore rules are part of the product logic, not just backend plumbing.
- Admin operations are now a first-class product surface, not an afterthought.
