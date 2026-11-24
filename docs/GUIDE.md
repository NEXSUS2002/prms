# PRMS operator guide

Detailed instructions that the [README](../README.md) leaves out: MetaMask, the demonstration, deployment, every
command and troubleshooting.

## MetaMask on the local chain

Reading pages needs no wallet. To sign an action, import that person's `privateKey` from `wallets.local.json` into
MetaMask (Add account, Import account), sign in to PRMS as that person, and click **Connect wallet**. PRMS adds the
local network (chain id 31337).

Only these people sign in MetaMask: patients (approve, revoke), doctors (emergency override), hospital
administrators (verify, suspend staff) and the registrar (admit, suspend hospitals). Nurses' and technicians' work
is recorded on the ledger by the server's relayer account, which must never be imported.

The local chain forgets everything when stopped: after restarting `pnpm chain`, run `pnpm bootstrap` again.

## Guided demonstration (about ten minutes)

1. **Cross-hospital safety (FR3).** As `dr_bello`, open Adaeze Okonkwo, New entry. Hypertension with Propranolol
   is blocked because asthma was recorded at another hospital. Amlodipine saves.
2. **Consent (FR1).** As `emeka`, approve Dr Adebayo's request in MetaMask, then revoke it and open the Audit log.
3. **Emergency override (FR2).** As `dr_okafor`, open Musa Ibrahim and use Emergency override. Signed in as
   `musa`, the override is in the audit log.
4. **Immutable addendum (FR4).** As `dr_bello`, dispute the peptic ulcer entry in Folake Adeyemi's record. The
   original stays, marked disputed, and an NSAID that was blocked before is now allowed.
5. **Laboratory (FR5, FR6, FR11).** As `dr_bello`, order a Full blood count for Adaeze at Oke-Ado Teaching
   Hospital. As `lab_haem`, find the requisition in the queue and upload a result. The expired GeneXpert
   requisition is refused.
6. **Nursing (FR7).** As `nurse_ojo`, see the three admitted patients and record vital signs.
7. **Administration (FR9, FR10, FR13).** As `admin_a`, verify Dr Umeh and add a department. As `registrar`,
   approve Lakeside District Hospital. Riverbend is refused because its wallet already administers another hospital.

Seeded consent expires 24 hours after seeding. Before a demonstration on Sepolia, run `pnpm demo:refresh`, then
`pnpm demo:check`. Steps 4 and 7 are permanent on the ledger, so rehearse them on the local chain.

## Deployment (Sepolia, Neon, Vercel)

1. **Database.** Create a [Neon](https://neon.tech) project and put its *pooled* connection string in `DATABASE_URL`.
2. **Wallet.** Create a new MetaMask wallet used for nothing else. Put its 12-word phrase in `WALLET_MNEMONIC`, set
   `CHAIN=sepolia`, and set `RPC_URL` to a Sepolia endpoint (Alchemy, Infura or a public node). `pnpm wallets` shows
   account 0. Fund it with about 0.15 Sepolia ETH from a faucet.
3. **Contract and data.** Run `pnpm bootstrap`, which takes 15–25 minutes on Sepolia. The contract address is saved
   in `deployments/sepolia.json`. The ledger cannot be erased, so seeding again needs a new contract, and
   `pnpm bootstrap` deploys one each time.
4. **Secret.** With `pnpm dev` stopped, run `pnpm secret:rotate`. It replaces the placeholder `BETTER_AUTH_SECRET`
   with a random one and re-encrypts the stored lab results to match.
5. **Hosting.** Import the GitHub repository in Vercel and keep the settings it detects. Add the variables below.
   Set the function region to Washington, D.C. (`iad1`), next to Neon's `us-east-1`. Then deploy.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Left empty, the embedded database is used, which does not work on Vercel |
| `BETTER_AUTH_SECRET` | Signs sessions and derives the lab-result keys. Must be random and kept secret |
| `BETTER_AUTH_URL` | The site's exact address, such as `http://localhost:3000` or `https://your-project.vercel.app` |
| `CHAIN` | `local` or `sepolia` |
| `RPC_URL` | Address of the blockchain node |
| `WALLET_MNEMONIC` | Phrase that every seeded wallet is derived from. The server uses account 1 as the relayer. Secret |
| `CONTRACT_ADDRESS` | Read from `deployments/` locally; required on Vercel |
| `SEED_FUND_ETH` | Sepolia only: test ETH the seed gives each wallet (default `0.002`) |

Do not run `pnpm dev` against Sepolia while the live site is in use: both would send transactions from the same
relayer account and their transaction numbers (nonces) would clash.

## Commands

| Command | What it does |
|---|---|
| `pnpm chain` | Start the local blockchain (Hardhat) on port 8545 |
| `pnpm bootstrap` | Compile and deploy the contract, migrate, seed. **Resets the database** |
| `pnpm dev` | Development server on port 3000 |
| `pnpm build` / `pnpm start` | Production build, and run it |
| `pnpm test` / `pnpm typecheck` | Automated tests / TypeScript check |
| `pnpm contract:compile` / `pnpm contract:deploy` | Compile the contract / deploy it to the network in `.env` |
| `pnpm db:generate` / `pnpm db:migrate` | Create a migration from the schema / apply migrations |
| `pnpm seed` | Load the seed data (needs a freshly deployed contract) |
| `pnpm wallets` | Show the deployer and relayer addresses and balances |
| `pnpm demo:check` | Read-only: report whether every demonstration step will work today |
| `pnpm demo:refresh` | Renew what expires with time: consents, Emeka's waiting request, open lab tokens |
| `pnpm secret:rotate` | Replace `BETTER_AUTH_SECRET` and re-encrypt stored lab results to match |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The smart contract has not been deployed" | Run `pnpm bootstrap` with `pnpm chain` running. On Vercel, set `CONTRACT_ADDRESS` |
| MetaMask transaction stuck, or "nonce" error | MetaMask, Settings, Advanced, **Clear activity tab data** (the local chain was restarted) |
| Wallet pill says "Choose account" | MetaMask has not shared that person's account with this site: click the pill and tick it |
| Access that worked yesterday is refused | Consent lasts 24 hours. Approve again as the patient, or run `pnpm demo:refresh` |
| "The ledger does not show you as a verified practitioner" | The local chain was restarted. Run `pnpm bootstrap` again |
| Sign-in fails on Vercel | `BETTER_AUTH_URL` must match the address bar exactly. Use the production address, not a preview one |
| Port 3000 or 8545 already in use | Another copy is still running. Close its terminal |
