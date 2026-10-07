-- Runs once, when the database volume is first created.
-- A separate, disposable database for the automated tests. The test run wipes it every time.
CREATE DATABASE ewm_test;
