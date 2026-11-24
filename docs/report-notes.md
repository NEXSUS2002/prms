# Where the code differs from the written report

Check these against Chapters 3 and 4 and adjust the text or the code so that they agree.

1. **Password hash.** Table 5 lists `password_hash` in `users`. Better Auth keeps it in its own `accounts`
   table (with `sessions` and `verifications`). The `users` table has the other listed columns.
2. **Extra columns.** `clinical_records.seq`, `patients.code`, `lab_requests.code`, `token_secret` and `tx_hash`,
   `lab_results.result_hash`, `access_grants.revoke_tx_hash`, `hospital_applications.admin_password_hash`,
   and a small `counters` table exist in the code and not in Table 5.
3. **Laboratory result encryption** is AES-256-GCM on the server with a key derived per ordering physician.
   It is not encryption to the physician's wallet key.
4. **Record hash.** Each record's hash is SHA-256 of the previous hash plus the record's content, for
   consultations, observations and addenda alike. Algorithm 3 in the document lists specific fields.
5. **Audit log.** Entries come from the database and each is confirmed by reading its transaction from the
   chain. An override made by calling the contract directly, without the app, would be on the chain but not
   in this list.
6. **Decline.** A patient can decline a request; the document's use cases mention approve and revoke.
7. **Hospital application.** The form asks for the administrator's password, which the design screen did not show.
