# Privacy and biometric data

Rollproof verifies employees by their face and their location. Both are personal data, and a face template is biometric data under the GDPR (Article 9), Indonesia's Personal Data Protection Law (UU PDP) and laws such as Illinois' BIPA. This page describes what the software does with that data, so a company running it can write its own privacy notice. It is not legal advice.

## What is collected and where it goes

| Data | When | Stored | Kept |
| --- | --- | --- | --- |
| Face photo | Enrolment, and each check-in or check-out | **Never.** The photo is decoded in memory, turned into a template and discarded. It is not written to disk, the database, logs or error reports. | Not kept |
| Face template | Enrolment | On the user's record: 128 numbers produced by SFace, plus the model name | Until an admin deletes it, the user is deleted, or the user enrols again |
| Location | Check-in and check-out, and failed attempts | Latitude, longitude and reported accuracy on the attendance record | As long as the attendance record |
| Device time | Check-in and check-out | The time of the button press and how long the event waited on the phone, to detect a wrong clock | As long as the attendance record |
| Account | Created by an admin | Name, email, employee id, role, site, supervisor, bcrypt password hash | Until deleted |

The template is compared one-to-one with the same user's own template; there is no search across employees and no face index. A template cannot be turned back into the photo it came from in any practical way, but treat it as sensitive anyway.

Face recognition runs on the company's own server (OpenCV, in-process). No photo, template or location is sent to a third party. Optional Sentry error reporting (`SENTRY_DSN`) is configured to send no request bodies, cookies, IP addresses or user details.

## What a deploying company should do

- Tell employees what is collected and why, and get consent where the law requires it (for biometrics it usually does, and in an employment relationship consent must be genuinely free, so offer another way to check in for anyone who declines).
- Decide and publish how long attendance records are kept; delete users who leave.
- Restrict admin accounts; admins can delete a user's face template from the user page (`DELETE /face/{user_id}`), and deleting a user removes their attendance, leave, overtime and assignments.
- Back up the database encrypted and off the host (`deploy/backup.sh` writes the archives; where they go is up to you).
- Serve the app only over HTTPS; the production stack does this by default.

## The public demo

The demo at demo.rollproof.app holds fictional people. If you enrol your face there, the template is stored on the throwaway employee account created for you and is **deleted with everything else at the daily reset at 00:00 UTC**. Your location is stored on the check-ins you make, until the same reset. The shared admin and supervisor accounts cannot have a face enrolled. Please do not enter real personal data anywhere else in the demo.

Questions: teesanfajar@gmail.com.
