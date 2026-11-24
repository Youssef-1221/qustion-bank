# CourseBank Firestore Security Specification

## 1. Data Invariants
1. All student profiles (`/users/{userId}`) contain PII (`email`) and are strictly readable and writable only by the verified owner (`request.auth.uid == userId`).
2. Every subject (`/subjects/{subjectId}`) belongs to an immutable `ownerId` matching `request.auth.uid`.
3. Every subcollection document (`materials`, `chunks`, `contentMap`, `questions`, `attempts`, `exams`) must carry `ownerId == request.auth.uid` and `subjectId == subjectId`, and creation/update/delete validates parent subject ownership via `get(/databases/$(database)/documents/subjects/$(subjectId))`.
4. All `allow list` queries evaluate `resource.data.ownerId == request.auth.uid` directly without `get()` or `exists()` calls.
5. `createdAt` and `updatedAt` timestamps must match `request.time` on creation and update respectively; `createdAt`, `ownerId`, and `subjectId` are immutable after creation.
6. Once an `ExamSimulation` reaches terminal `status == 'submitted'`, no further updates are permitted.
7. All document ID path variables must pass `isValidId()` (`^[a-zA-Z0-9_-]+$`, `<= 128` chars), and all strings and arrays enforce strict size upper bounds.

## 2. Adversarial "Dirty Dozen" Payloads
1. **Unauthenticated Subject Read**: Anonymous request reading `/subjects/sub1` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Authenticated user with `email_verified == false` creating a subject -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Subject Create**: User A creating `/subjects/sub1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: User A creating `/subjects/sub1` with extra ghost key `isAdmin: true` -> `PERMISSION_DENIED`.
5. **Cross-Tenant List Scraping**: User B calling `list` on `/subjects` without `where('ownerId', '==', userB.uid)` -> `PERMISSION_DENIED`.
6. **Orphan Material Injection**: User A creating `/subjects/nonexistent/materials/mat1` -> `PERMISSION_DENIED` (Master Gate parent subject missing).
7. **Cross-Owner Subcollection Write**: User B writing `/subjects/subA/questions/q1` even with `ownerId: userB.uid` -> `PERMISSION_DENIED` (Master Gate parent `ownerId != userB.uid`).
8. **Path ID Poisoning**: User A creating `/subjects/invalid$id/materials/mat1` -> `PERMISSION_DENIED`.
9. **Immutable Owner Tampering**: User A updating `/subjects/subA` to change `ownerId` to `userB` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: User A creating `/subjects/subA` with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
11. **Terminal Exam Mutation**: User A updating `/subjects/subA/exams/ex1` after `status == 'submitted'` -> `PERMISSION_DENIED`.
12. **PII Leak Attempt**: User B calling `get` on `/users/userA` -> `PERMISSION_DENIED`.
