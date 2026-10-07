# CARE QR: full manual testing guide

This guide takes you through every role in CARE QR, one sign-in at a time, using ready-made dummy data. Every person, bed, and request in it is made up. No real patient information is used anywhere.

How to use it: keep the app open in one browser window and this guide in another. Do the tests in order. For each test ID, write **PASS**, **FAIL**, or **BLOCKED** in the [results table](#9-results-table) at the end, with a short note when something looks wrong.

---

## 1. Before you start

### Start the app

Open two Terminal windows.

```bash
cd ~/Downloads/QR_Hospital_management/services && npm run dev
```

```bash
cd ~/Downloads/QR_Hospital_management/frontend && npm run dev
```

Open **http://localhost:5173**. PostgreSQL and Redis must be running (see the [easy guide](./easy-guide.md#7-one-time-local-setup)).

### Load the test data (once)

Your development database **already has this data**; it was loaded on 6 Oct 2026. On a new, empty database run this once, from `services/`:

```bash
npm run prisma:migrate && npm run seed:test
```

`seed:test` only adds the two test hospitals below. It never changes another hospital, and running it again leaves existing test hospitals as they are. Request history is permanent by design, so the test data cannot be "reset". To start again from scratch, point `DATABASE_URL` in `services/.env` at a new empty local database, then run the two commands again.

### Passwords

| Who | Password |
|---|---|
| Every staff account in **CITYCARE** and **GREENVALLEY** | the value of `DEMO_STAFF_PASSWORD` in `services/.env` |
| Super admin `platform.demo@careqr.example` | the value of `DEMO_PLATFORM_PASSWORD` in `services/.env` |

Never paste these passwords, QR links, or tokens into a chat, a ticket, or Git.

### Times move on

The data was created around **22:30 on 6 Oct 2026 (India time)**. "Today" in this guide means that day. When you test later, today's requests show as sent "x hours ago" or on an earlier date, and every open request is overdue. That is expected. In **Reports**, choose **Last 30 days** (or **Choose dates** from 22 Sep to today) to see all the history.

### Signing in

- **Staff:** go to http://localhost:5173, choose **Staff sign in**, and enter the **hospital code**, **email**, and password.
- **Super admin:** go to http://localhost:5173/platform/login.
- Use **Sign out** (top right) before switching to another person. To stay signed in as two people at once, use a second browser or a private window.

---

## 2. The test hospitals

Each hospital belongs to a **client**, the customer organisation that buys CARE QR. One client can own several hospitals (branches). The super admin manages clients and hospitals only, never what happens inside a hospital.

| Client | Hospitals |
|---|---|
| **CityCare Health Group** | CityCare Multispeciality Hospital (`CITYCARE`) |
| **Green Valley Healthcare** | Green Valley Clinic (`GREENVALLEY`) |
| Sunrise Multispeciality Hospital | Sunrise (`SUNRISE`) |
| CARE QR Demo Hospital | CARE QR Demo (`CAREQR-DEMO`) |

### CityCare Multispeciality Hospital (code `CITYCARE`)

This is the main hospital for testing: 19 people, 29 beds, and about 110 requests over the last 14 days.

```text
CityCare Multispeciality Hospital
├── Main Block
│   ├── Ground Floor
│   │   └── Emergency ............ Trolley 01–04       (Trolley 01 has a patient; Trolley 03's QR is disabled)
│   ├── First Floor
│   │   ├── General Ward A ....... Bed A 01–A 08       (A 01–A 05 have patients; A 08 is under maintenance)
│   │   └── Private Rooms ........ Room 101–104, one bed each (Bed 101 and Bed 102 have patients)
│   └── Second Floor
│       ├── ICU .................. ICU Bed 01–06       (01–03 have patients; 05 and 06 are ventilator beds)
│       └── Maternity Ward ....... Room 201, 202, two beds each (Bed 201-A and 201-B have patients)
└── Day Care Block
    └── Ground Floor
        └── Dialysis Unit ........ Dialysis Chair 01–03 (Chair 01 has a patient)
```

- **14 beds have patients** (an active admission); 6 more had patients earlier and were discharged.
- **QR codes:** every bed that has had a patient has a QR. Bed A 01's QR was replaced 5 days ago. Trolley 03's QR was disabled.
- **Departments:** Nursing, Housekeeping, Pantry, Maintenance, Patient Assistance, Billing, Transport, and a custom **Laboratory** department. **Billing has no staff on purpose**, so Billing requests cannot be assigned.
- **Services patients can ask for:**

| Group | Service | Team | Response target |
|---|---|---|---|
| Food & Water | Drinking Water | Pantry | Quick response: accept in 3 min, done in 10 |
| Food & Water | Meal / Diet Query | Pantry | Standard: 10 / 60 min |
| Nursing Help | Nurse Assistance (high priority) | Nursing | Quick response; escalation policy "Nursing overdue" |
| Room & Cleaning | Room Cleaning | Housekeeping | Standard |
| Room & Cleaning | Extra Blanket / Linen | Housekeeping | Within 30 minutes: 10 / 30 min |
| Repairs | AC / Light / TV Not Working | Maintenance | Standard |
| Assistance | Wheelchair | Transport | Standard |
| Assistance | Washroom Help (high priority) | Patient Assistance | Quick response |
| Assistance | Newspaper | Patient Assistance | **Inactive**: patients do not see it |
| Billing & Discharge | Billing Query | Billing | Standard (nobody can take it) |

- **Upcoming shifts** (for display only; a shift does not put anyone on duty): Rahul, Anjali, and Geeta tomorrow, and Pavan the day after.

### Green Valley Clinic (code `GREENVALLEY`)

A second, small client used to check that hospitals never see each other's data. It has one floor with a Day Care unit (Chair 01–04, two with patients), a Hospital Manager, and one nurse. It has no Pantry staff, so its Drinking Water request cannot be assigned.

---

## 3. Who is who (all logins)

The password for every account below is `DEMO_STAFF_PASSWORD` (see [Passwords](#passwords)).

### CityCare (hospital code `CITYCARE`)

| Person | Email | Role (where it applies) | Team and beds covered | Duty now |
|---|---|---|---|---|
| Dr. Meera Iyer | `meera.iyer@citycare.example` | **Hospital Manager** (whole hospital) | — | — |
| Arjun Mehta | `arjun.mehta@citycare.example` | **Operations Manager**, a custom role (whole hospital) | — | — |
| Kavita Joshi | `kavita.joshi@citycare.example` | **Admission Desk**, a custom role (whole hospital) | — | — |
| Ravi Shankar | `ravi.shankar@citycare.example` | **Floor Manager** (Main Block · First Floor) | — | — |
| Sunita Rao | `sunita.rao@citycare.example` | **Floor Manager** (Main Block · Second Floor) | — | — |
| Priya Nair | `priya.nair@citycare.example` | **Ward Manager** (ICU) | — | — |
| Imran Khan | `imran.khan@citycare.example` | **Department Supervisor** (Pantry) | — | — |
| Lakshmi Pillai | `lakshmi.pillai@citycare.example` | **Department Supervisor** (Housekeeping) | — | — |
| Anjali Sharma | `anjali.sharma@citycare.example` | Care Staff | Nursing · First Floor | On duty |
| Deepa Thomas | `deepa.thomas@citycare.example` | Care Staff | Nursing · Second Floor (ICU, Maternity) | On duty |
| Rahul Verma | `rahul.verma@citycare.example` | Care Staff | Nursing · First and Second Floor | **Off duty** since yesterday 20:00 |
| Farah Ali | `farah.ali@citycare.example` | Care Staff | Nursing · Emergency and Dialysis | On duty |
| Pavan Kumar | `pavan.kumar@citycare.example` | Care Staff | Pantry · whole hospital | On duty |
| Neha Gupta | `neha.gupta@citycare.example` | Care Staff | Pantry · First and Second Floor | On duty |
| Suresh Yadav | `suresh.yadav@citycare.example` | Care Staff | Housekeeping · whole hospital | On duty |
| Geeta Devi | `geeta.devi@citycare.example` | Care Staff | Housekeeping · Second Floor | On duty |
| Manoj Singh | `manoj.singh@citycare.example` | Care Staff | Transport and Patient Assistance · whole hospital | On duty |
| Vikram Patil | `vikram.patil@citycare.example` | Care Staff | Maintenance · whole hospital | On duty |
| Karan Malhotra | `karan.malhotra@citycare.example` | Care Staff | Housekeeping · First Floor | **Suspended**: cannot sign in |

### Green Valley (hospital code `GREENVALLEY`)

| Person | Email | Role |
|---|---|---|
| Dr. Rohan Das | `rohan.das@greenvalley.example` | Hospital Manager |
| Sneha Kulkarni | `sneha.kulkarni@greenvalley.example` | Care Staff (Nursing, whole clinic, on duty) |

### Super admin (no hospital code)

| Person | Email | Where to sign in |
|---|---|---|
| Demo Platform Admin (super admin) | `platform.demo@careqr.example` | http://localhost:5173/platform/login |

---

## 4. Roles and what each one may do

**"Area"** means the floor, ward, or department the role was given for. For example, Ravi is a Floor Manager **for the First Floor only**.

| What they can do | Super admin | Hospital Manager | Operations Manager | Admission Desk | Floor / Ward Manager | Department Supervisor | Care Staff | Patient |
|---|---|---|---|---|---|---|---|---|
| Add clients and their hospitals (logo, first manager); edit client contacts; move a hospital to another client | ✅ | — | — | — | — | — | — | — |
| Suspend or reactivate a whole client, or one hospital | ✅ | — | — | — | — | — | — | — |
| See patients, requests, or staff of a hospital | ❌ never | ✅ | ✅ | — | own area | own department | own work only | own bed only |
| Change hospital profile and logo | — | ✅ | — | — | — | — | — | — |
| See the audit log | — | ✅ | ✅ | — | — | — | — | — |
| See reports | — | ✅ whole hospital | ✅ whole hospital | — | ✅ own area | ✅ own department | — | — |
| Change the layout (floors, wards, rooms, beds) | — | ✅ | — | — | — | — | — | — |
| Admit and discharge patients | — | ✅ | ✅ | ✅ | ✅ own area | — | — | — |
| Create, print, and replace QR labels | — | ✅ | — | ✅ (not disable) | — | — | — | — |
| Add staff; set duty, departments, coverage; suspend | — | ✅ | ✅ (only people with less access than them) | — | — | — | — | — |
| Create roles and give them to people | — | ✅ | see only | — | — | — | — | — |
| Change services and response targets | — | ✅ | see services only | — | — | — | — | — |
| Assign requests to staff | — | ✅ | ✅ | — | ✅ own area | ✅ own department | — | — |
| Hand accepted work to someone else | — | ✅ | ✅ | — | ✅ own area | ✅ own department | — | — |
| Cancel a waiting or assigned request (with a reason) | — | ✅ | ✅ | — | ✅ own area | ✅ own department | — | ✅ own request |
| Accept, start, complete, or turn down **their own** assigned work | — | — | ✅ (if assigned) | — | — | — | ✅ | — |
| Close completed requests | — | ✅ | ✅ | — | ✅ own area | ✅ own department | — | — |
| Send a request by scanning the bed QR | — | — | — | — | — | — | — | ✅ |

Rules that always apply:

- Nobody can change a role, or suspend a colleague, who has **more access** than they do.
- The **Hospital Manager** role always has every permission and cannot be edited, and a hospital can never lose its **last active** Hospital Manager.
- A request can only be given to someone who is **active, on duty, in the right team, and covering that bed**. Check this on the **Who can respond?** page.

### What each person sees in the menu

| Person | Menu |
|---|---|
| Meera (Hospital Manager) | Overview, Requests, Reports, Profile & logo, Audit log, Beds & QR, Location setup, Departments, Staff & coverage, Roles & access, Who can respond?, Service catalog, Response targets (SLA) |
| Arjun (Operations Manager) | Overview, Requests, Reports, Audit log, Beds & QR, Departments, Staff & coverage, Roles & access, Who can respond?, Service catalog |
| Kavita (Admission Desk) | Overview, Beds & QR |
| Ravi, Sunita (Floor Managers); Priya (Ward Manager) | Overview, Requests, Reports, Beds & QR |
| Imran, Lakshmi (Department Supervisors) | Overview, Requests, Reports |
| Care staff (Anjali, Pavan, Neha, …) | Overview, Requests |

---

## 5. What is waiting in the data right now

These requests were open when the data was loaded, so every role has something to do. Bed names are as shown in the app.

| Bed | Service | State | With | Try this |
|---|---|---|---|---|
| Bed A 04 | Drinking Water | Waiting for assignment | — | Ravi, Imran, Arjun, or Meera assigns it to Neha or Pavan |
| ICU Bed 02 | Nurse Assistance (high) | Waiting, overdue | — | Priya or Sunita assigns it to Deepa |
| Bed 102 | Billing Query | Waiting | — | Nobody can take it (no Billing staff): see the hint, then cancel it with a reason |
| Bed A 02 | Room Cleaning | Assigned, overdue | Suresh Yadav | Suresh accepts it, or turns it down with a reason |
| Bed A 03 | Meal / Diet Query | Assigned | Neha Gupta | Neha accepts or turns it down |
| ICU Bed 03 | Drinking Water | Assigned (handed over from Pavan) | Neha Gupta | Neha accepts, starts, and completes it |
| Trolley 01 | Nurse Assistance | Assigned | Farah Ali | Farah accepts it |
| ICU Bed 01 | Nurse Assistance | Accepted | Deepa Thomas | Priya tries to hand it over (nobody else is on duty) |
| Dialysis Chair 01 | Washroom Help | Accepted | Manoj Singh | Manoj starts and completes it |
| Bed 201-A | Extra Blanket / Linen | In progress | Geeta Devi | Lakshmi hands it over to Suresh |
| Bed A 01 | Wheelchair | In progress | Manoj Singh | Manoj marks it complete |
| Bed 101 | Meal / Diet Query | Completed, ready to close | Pavan Kumar | Imran or Ravi closes it |
| Bed A 05 | AC / Light / TV Not Working | Completed, ready to close | Vikram Patil | Ravi or Arjun closes it |
| Bed 102 | Drinking Water (yesterday) | Completed, ready to close | Neha Gupta | Imran or Ravi closes it |

**History you will find in Reports.** These are the "why not completed" stories:

- **Turned down by staff:** Pavan at ICU Bed 02 (patient fasting before surgery); Neha at Bed A 02 (diet chart not updated); Karan at Bed 103 (patient asleep); Manoj at Bed A 01 (wheelchair under repair).
- **Cancelled by a manager:** Ravi ("Duplicate request"), Priya ("Patient taken for a CT scan"), Arjun ("Answered at the billing counter").
- **Cancelled by the patient:** for example "Family brought water" and "Not needed any more".
- **Handed over:** Deepa to Rahul ("My shift has ended"), Karan to Suresh ("Karan went on break"), and Pavan to Neha today ("Busy with another patient").
- **Late:** for example the Wheelchair at Bed A 04 two days earlier (took 95 minutes against a 60-minute target).
- **Staff changes in the audit log:** Arjun set Rahul off duty yesterday and suspended Karan 3 days ago. Kavita replaced Bed A 01's QR, and Meera disabled Trolley 03's QR.

---

## 6. Tests, role by role

Expected results are marked ✔. If the screen differs, record **FAIL** with what you saw.

### 6.1 Super admin: `platform.demo@careqr.example`

The super admin manages **clients** (customers) and their **hospitals**. They never see patients, requests, or staff records inside a hospital, only counts.

| ID | Do this | ✔ Expected |
|---|---|---|
| P01 | Sign in at `/platform/login`. | The header says **CARE QR Super Admin**, with **Clients** and **Hospitals** tabs. **Clients** lists 4 clients, including **CityCare Health Group** (contact Dr. Meera Iyer) and **Green Valley Healthcare**, each with how many hospitals, beds, and staff it has. Totals at the top. |
| P02 | Open **CityCare Health Group**. | Client page with its code, status **active**, totals, editable contact details, and its hospital list (CityCare Multispeciality Hospital). No patient or request details. |
| P03 | Change the contact phone and **Save details**. | "Client details saved." In Meera's **Audit log** it appears as "Platform changed the client (group)". |
| P04 | On the client page click **Add hospital** → fill in a branch, for example "CityCare Whitefield" with code `CITYCARE-WF`, a first manager with a new `@example.test` email, and **Generate** a password → **Create hospital**. | The new hospital opens and shows "client CityCare Health Group". Back on the client page, CityCare Health Group now has **2 hospitals**. The new branch has none of CityCare's people, beds, or requests (see H17). |
| P05 | **Clients** → **Add client**: a new client (for example "Lotus Health", with a contact person) and its first hospital and manager → **Create client**. | The new client page opens with 1 hospital. The **Hospitals** tab lists the new hospital with "client Lotus Health". |
| P06 | **Hospitals** tab → search `green` → open **Green Valley Clinic**. | Shows "client Green Valley Healthcare", its logo, managers, and a **Client** list to move it to another client. |
| P07 | Open **Green Valley Healthcare** → **Suspend client** → confirm. Try to sign in as `rohan.das@greenvalley.example`. | The warning says all its hospitals close at once. Sign-in is refused, and Green Valley's patient QR codes stop working. The hospital's own status still says **active**, but its page says the client is suspended. CityCare is not affected. **Add hospital** is disabled for a suspended client. |
| P08 | **Reactivate client**. Sign in as Rohan again. | Sign-in works again. No data was lost. |
| P09 | Open **CityCare Multispeciality Hospital** → **Suspend hospital** → confirm, then try to sign in as Meera. Then **Reactivate hospital**. | Only that one hospital closes (the CityCare Whitefield branch from P04 stays open); after reactivating, Meera can sign in again. |

### 6.2 Hospital Manager: Dr. Meera Iyer (`CITYCARE`)

| ID | Do this | ✔ Expected |
|---|---|---|
| H01 | Sign in. | **Overview** greets Dr. Meera Iyer. The top bar shows the CityCare logo. Counters show waiting, being handled, overdue, completed today, occupied beds (14 of 29 at load), and staff on duty (9 of 18). Each counter opens its screen. |
| H02 | Open **Location setup**. Expand the tree. | Main Block (Ground, First, Second Floor) and Day Care Block (Ground Floor) exactly as in [section 2](#2-the-test-hospitals). Both blocks have a floor coded `G`. **Whole hospital** shows bed totals by unit type. |
| H03 | Open **General Ward A**. Check Bed A 08. Then **Add beds**: 2 beds. | Bed A 08's status is **maintenance**. The preview lists the next codes. After saving, a green bar offers **Print QR labels (2)**. |
| H04 | Click **Print QR labels**, choose **Medium**, then **Download PDF**. | A PDF with 2 labels, each showing the CityCare logo, the bed name, the full location, and the emergency warning. |
| H05 | Open **Beds & QR**. Set the sessions filter to **Active sessions**, then back to **All beds** and search `ICU`. | 14 beds with an active session; the ICU search shows ICU Bed 01–06. Trolley 03's QR shows **Revoked**, and Bed A 01's shows **Active · version 2** (it was replaced). |
| H06 | On **Bed A 07** (no patient now) click **Start session**. Then **Close session**. | The bed becomes occupied, then available again. Both appear in the audit log (H15). |
| H07 | Open **Departments**. | 8 departments, including the custom **Laboratory**. (Billing and Laboratory have nobody in them; you can see this in **Staff & coverage**.) |
| H08 | Open **Staff & coverage**. | 19 people. Karan Malhotra's status is **suspended**, Rahul Verma is **Off duty**, and each person's roles show where they apply (for example "Floor Manager · First Floor"). |
| H09 | Open **Roles & access**. | Five built-in roles plus **Operations Manager** and **Admission Desk**. Hospital Manager has every permission and no **Edit** button. |
| H10 | Open **Who can respond?** Choose **ICU Bed 01** and **Nursing**, then **Check eligibility**. | Only **Deepa Thomas**. Rahul covers that floor but is off duty. |
| H11 | In **Staff & coverage**, set **Rahul Verma** on duty. Repeat H10. | Deepa **and Rahul** are now listed. Leave Rahul on duty for test W03. |
| H12 | Open **Service catalog**. | 10 services in 6 groups. **Newspaper** is inactive. Nurse Assistance shows the "Nursing overdue" escalation policy (alerts are configured but do not fire yet). |
| H13 | Open **Response targets (SLA)**. Change **Within 30 minutes** to 10 / 40 and save. | A new version **v2** is added; v1 stays in history. Old requests keep their old target. |
| H14 | Open **Requests**. | **Open** has 11 requests, the most urgent first, with red "overdue by …" where late. **Ready to close** has 3, **History** about 96. Accepted and in-progress cards show **Hand over…**. |
| H15 | Open **Audit log**. Choose **Request handling**, then **Staff**, then **Load older changes**. | Plain sentences with who and when, for example "Handed a request to someone else" with its reason, "Changed staff status" for Karan (active → suspended), and "Changed duty (on/off)" for Rahul. The oldest entries are the hospital setup about 20 days earlier. |
| H16 | Open **Profile & logo**. Upload a different PNG logo and save. | The new logo shows in the top bar straight away and on the patient page (PT01). |
| H17 | Sign out and sign in with the branch hospital and manager you created in P04. | The new hospital is empty apart from its starter departments and services. None of CityCare's people or beds appear. |

### 6.3 Operations Manager: Arjun Mehta (custom role)

| ID | Do this | ✔ Expected |
|---|---|---|
| O01 | Sign in. Check the menu. | As in [section 4](#what-each-person-sees-in-the-menu). There is no **Profile & logo**, **Location setup**, or **Response targets** page. |
| O02 | Open **Beds & QR**. | **Start session** and **Close session** are available, but no Generate, Replace, or Print QR buttons. |
| O03 | Open **Roles & access**. | Roles are visible but cannot be created, edited, or deleted. |
| O04 | In **Staff & coverage**, try to **suspend Dr. Meera Iyer**. | Refused: "You do not have permission to perform this action." Meera stays active. |
| O05 | Suspend **Ravi Shankar**, then make him active again. | Both work, because Ravi has less access than Arjun. While suspended, Ravi is signed out everywhere. |
| O06 | Open **Requests**. **Close** the AC / Light / TV request at Bed A 05. | It moves to **History**. |
| O07 | Open **Audit log**. | Visible; O05 appears at the top. |

### 6.4 Admission Desk: Kavita Joshi (custom role)

| ID | Do this | ✔ Expected |
|---|---|---|
| K01 | Sign in. | Menu: **Overview** and **Beds & QR** only. No requests are visible. |
| K02 | Open `http://localhost:5173/admin/requests` directly. | **Access restricted**. |
| K03 | In **Beds & QR**, on **Bed A 06** (discharged, has a QR) click **Start session**. Then **Replace QR** → **Open patient view**. | The bed is now occupied. The patient page opens for Bed A 06 with no old requests (it is a new stay). Keep this tab for the patient tests. |
| K04 | **Close session** on Bed A 06 and refresh the patient tab. | The patient sees "Your session has ended". |

### 6.5 Floor Manager: Ravi Shankar (First Floor)

| ID | Do this | ✔ Expected |
|---|---|---|
| F01 | Sign in. Open **Requests**. | Only First Floor beds (Bed A 0x and Bed 10x). Nothing from ICU, Maternity, Emergency, or Dialysis. |
| F02 | On **Bed A 04 · Drinking Water** click **Choose staff**. | Only eligible Pantry staff: **Neha Gupta** and **Pavan Kumar**. Assign it to **Pavan**. |
| F03 | On **Bed 102 · Billing Query** click **Choose staff**. | "No eligible on-duty staff…" Then **Cancel…** → choose **Other**, type "Billing desk will visit", and confirm. It moves to **History**. |
| F04 | On **Bed A 01 · Wheelchair** (in progress) click **Hand over…**. | "Nobody else is eligible right now": Manoj is the only Transport person. Click **Keep with Manoj Singh**. |
| F05 | **Ready to close** → close **Bed 101 · Meal / Diet Query**. | It moves to **History**. |
| F06 | Open **Reports** → **Last 30 days**. | Totals and staff work for the **First Floor only** (smaller than Meera's numbers). |
| F07 | Open `/admin/audit` and `/admin/staff` directly. | **Access restricted** on both. |
| F08 | Open **Beds & QR**. | Only First Floor beds. **Start session** is available but no QR printing. |

### 6.6 Ward Manager: Priya Nair (ICU)

| ID | Do this | ✔ Expected |
|---|---|---|
| W01 | Sign in. Open **Requests**. | Only ICU beds (ICU Bed 01–03). |
| W02 | Assign **ICU Bed 02 · Nurse Assistance** to **Deepa Thomas**. | Assigned. The card shows "Assigned to Deepa Thomas". |
| W03 | On **ICU Bed 01 · Nurse Assistance** (accepted by Deepa) click **Hand over…**. | If you did H11, **Rahul Verma** is offered: choose reason **My shift has ended** and hand over. Otherwise "Nobody else is eligible". After handing over, the card is **Assigned** to Rahul. |
| W04 | Open **Reports**. | Only ICU requests. **Not completed** includes Pavan's turned-down Drinking Water ("Patient is fasting before surgery…"). |

### 6.7 Department Supervisors: Imran Khan (Pantry) and Lakshmi Pillai (Housekeeping)

| ID | Do this | ✔ Expected |
|---|---|---|
| D01 | Sign in as **Imran**. Open **Requests**. | Only Pantry requests (Drinking Water and Meal / Diet Query) from every floor. |
| D02 | **Ready to close** → close **Bed 102 · Drinking Water**. | It moves to **History**. |
| D03 | Open **Reports** → **Last 30 days**. | Only Pantry work: Pavan, Neha, and the managers who assigned it. Neha's row shows "Turned down: Diet chart not yet updated by the dietician". |
| D04 | Sign in as **Lakshmi**. On **Bed 201-A · Extra Blanket / Linen** (in progress with Geeta) click **Hand over…**. | **Suresh Yadav** is preselected. Hand over with the reason **Busy with another patient**. The card shows "Assigned to Suresh Yadav". |
| D05 | Open **Beds & QR** directly (`/admin/beds`). | **Access restricted**: supervisors manage work, not beds. |

### 6.8 Care staff

| ID | Do this | ✔ Expected |
|---|---|---|
| C01 | Sign in as **Neha Gupta**. | Menu: Overview and Requests. **My open work** shows only her two requests (ICU Bed 03 Drinking Water, Bed A 03 Meal / Diet Query). |
| C02 | On **ICU Bed 03 · Drinking Water**: **Accept** → **Start work** → **Mark complete**. | Each step moves the card on. It ends in **Completed** for a manager to close. |
| C03 | On **Bed A 03 · Meal / Diet Query** click **Turn down…**, choose **Patient not at the bed**, and confirm. | The request leaves her list. In Meera's **Reports → Not completed**, it shows "Turned down by Neha Gupta", the time, and the reason. |
| C04 | Open `/admin/reports` directly. | **Access restricted**. |
| C05 | Sign in as **Suresh Yadav** → accept **Bed A 02 · Room Cleaning** → start → complete. | Each step works, and the card ends in **Completed**. |
| C06 | Sign in as **Farah Ali** → accept **Trolley 01 · Nurse Assistance**. | Works. Farah sees no First or Second Floor work. |
| C07 | Try to sign in as **Karan Malhotra**. | Refused. He is suspended. |
| C08 | Sign in as **Rahul Verma** (before H11) or after Meera sets him off duty again. | **My open work** is empty, and he is not offered when managers assign Nursing work. His past work is in **History**. |

### 6.9 Patient (QR scan, no login)

Get a patient link first: as **Meera** or **Kavita**, open **Beds & QR** → **Bed A 01** → **Replace QR**. In the QR window click **Copy patient link** and paste it into a private note (you need it again in PT07), then click **Open patient view**. Keep the link private. Replacing a QR stops the old printed one.

| ID | Do this | ✔ Expected |
|---|---|---|
| PT01 | Open the patient view for **Bed A 01**. | CityCare logo and name, "Bed A 01 · General Ward A", the red "not for emergencies" notice, and service groups. **Newspaper** and anything else inactive are not shown. |
| PT02 | Look at **Your requests**. | This stay's history, newest first. It includes the Wheelchair in progress, today's Nurse Assistance (closed), a Drinking Water cancelled by the family, and an older Wheelchair shown as **Rejected** (turned down by staff). |
| PT03 | Ask for **Drinking Water**. | A new request with a `CR-…` reference and **Submitted**. Asking again shows the same request, not a duplicate. |
| PT04 | As **Ravi**, assign it to **Pavan**; as **Pavan**, accept, start, and complete it. Watch the patient tab (or tap **Refresh status**). | The progress bar moves through Assigned → Accepted → In progress → Completed within 30 seconds of each step. |
| PT05 | Ask for **Room Cleaning**, then **Cancel request** → **Yes, cancel request**. | Status **Cancelled**. In Reports it counts as "cancelled by the patient". |
| PT06 | Switch **Language** to हिन्दी and back. | The page switches to Hindi and back. |
| PT07 | As **Meera**, click **Replace QR** on Bed A 01 again. Refresh the patient tab, then open the link you saved in your note. Finally open the new link. | The patient tab ends within about 30 seconds. The saved (old) link shows "We couldn't connect". The new link works. |

### 6.10 Reports and audit, in detail (as Meera)

The numbers below are what the data had when loaded, for **Last 30 days**. Your own tests in this guide change them a little.

| ID | Do this | ✔ Expected |
|---|---|---|
| R01 | **Reports** → **Last 30 days**. | About **110** requests, **85** completed, **11** still open, **10** cancelled (**7** by the patient), **4** turned down, and on-time percentages of about 85–90%. "Overdue now" grows as time passes. |
| R02 | **Staff work** tab. | 18 rows. Care staff show assigned, accepted, completed, on time, turned down (with reasons), handed over, open now, and average times. Managers (Ravi, Imran, Lakshmi, Priya, …) show **Assigned others** and **Closed**. |
| R03 | Click **Pavan Kumar**. | The **Request log** opens filtered to Pavan's requests. |
| R04 | **Not completed** tab. | About 22 items: each cancelled, turned-down, or overdue request with who, when, and the reason. |
| R05 | On any item click **Full history**. | Every step in order with who did it and when: **Request sent** by Patient, **Assigned** by a manager to a staff member, **Handed over** from one person to another (with the reason), and so on. |
| R06 | **Request log** → filter by result **Turned down**, then search a `CR-` reference, then **Download CSV**. | The filters work. The CSV opens in Excel with one row per request and names intact. |
| R07 | **Departments & services** tab. | Counts per team and per service; Pantry and Nursing are the busiest. |
| R08 | Try **Today**, **Last 7 days**, **This month**, and **Choose dates**. | Each period changes the numbers. The date pickers do not let the end date fall before the start date. |

### 6.11 Separation between hospitals

| ID | Do this | ✔ Expected |
|---|---|---|
| S01 | Sign in as **Rohan Das** (`GREENVALLEY`). | Only Green Valley: 4 chairs, 2 people, and its own logo. |
| S02 | **Requests**: on **Chair 01 · Drinking Water** click **Choose staff**. | "No eligible on-duty staff": Green Valley has no Pantry staff. |
| S03 | **Reports** → **Last 7 days**. | 3 requests only, none of CityCare's. |
| S04 | Try signing in to `CITYCARE` with Rohan's email. | Refused: his account belongs to Green Valley only. |

### 6.12 Security checks

| ID | Do this | ✔ Expected |
|---|---|---|
| N01 | Enter a wrong password for `rahul.verma@citycare.example` 11 times in a row. | Attempts 1–10 say the details are wrong. From attempt 11: "Too many requests. Please wait and try again." Other people can still sign in. Rahul can sign in again after 15 minutes. |
| N02 | Sign in with a hospital code that does not exist, and with an email that does not exist. | The same message in both cases. It never says which part was wrong. |
| N03 | As a care staff member, open `/admin/staff`, `/admin/roles`, `/admin/audit`, and `/admin/reports`. | **Access restricted** on each. |
| N04 | As **Meera**, try to suspend herself while she is the only Hospital Manager. | Refused: "A hospital must keep at least one active Hospital Manager." |

---

## 7. Automatic tests

Developers can run these instead of clicking through. They need a **separate, disposable** test database in `TEST_DATABASE_URL` (never the development database):

```bash
cd ~/Downloads/QR_Hospital_management/services && npm test && npm run test:integration
```

```bash
cd ~/Downloads/QR_Hospital_management/frontend && npm test
```

`tests/integration/test-seed.test.ts` loads this same test data into the test database and checks every sign-in, each role's access, the report numbers, and that every request's history is complete and in order.

---

## 8. If something goes wrong

| Problem | Fix |
|---|---|
| "Cannot reach the hospital system" | The backend window is not running, or PostgreSQL or Redis is stopped. |
| Sign-in fails for everyone in CITYCARE | Check the hospital code and that you are using `DEMO_STAFF_PASSWORD`. If you just tried many wrong passwords, wait 15 minutes. |
| `seed:test` says a hospital "already exists" | It is already loaded; nothing was changed. Use it as it is. |
| `seed:test` says a login email already exists | Someone created a user with one of the test emails. Use a new empty database. |
| A request in this guide is in a different state | You (or an earlier test) already moved it on. Use another request in the same state, or send a new one from a patient tab. |
| Patient page says "We couldn't connect" | The bed has no patient (start a session) or the QR was replaced or disabled (use the newest link). |

---

## 9. Results table

Copy this table and fill it in as you go.

| ID | Result | Note |
|---|---|---|
| P01–P09 | | |
| H01–H17 | | |
| O01–O07 | | |
| K01–K04 | | |
| F01–F08 | | |
| W01–W04 | | |
| D01–D05 | | |
| C01–C08 | | |
| PT01–PT07 | | |
| R01–R08 | | |
| S01–S04 | | |
| N01–N04 | | |
