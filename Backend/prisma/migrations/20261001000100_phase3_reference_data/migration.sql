-- Phase 3 reference data: system ledger accounts for cards and bills, the biller catalog,
-- the fraud rules and policy, and the MOCK sanctions list. Change any of these with a new
-- migration (auditable, reviewed).

-- New system accounts (LIABILITY, credit-normal, may go negative like every system account):
--   CARD_HOLDS               money held for pending card authorizations (wallet -> holds at
--                            authorization; holds -> network at capture; holds -> wallet on
--                            reversal / expiry of the hold)
--   CARD_NETWORK_SETTLEMENT  captured card spend owed to the card network until net settlement
--   BILLS_PAYABLE            bill payments collected from wallets and owed to billers
INSERT INTO "ledger_accounts" ("id","code","name","type","normal_balance","owner_type","currency","allow_negative","balance","version","updated_at")
SELECT gen_random_uuid(), a.code || '.' || c.cur, a.name || ' (' || c.cur || ')', a.type::"AccountType",
       a.side::"NormalBalance", 'SYSTEM', c.cur::"Currency", true, 0, 0, now()
FROM (VALUES
  ('CARD_HOLDS',              'Card authorization holds',       'LIABILITY', 'CREDIT'),
  ('CARD_NETWORK_SETTLEMENT', 'Card network settlement payable', 'LIABILITY', 'CREDIT'),
  ('BILLS_PAYABLE',           'Bills payable to billers',        'LIABILITY', 'CREDIT')
) AS a(code, name, type, side)
CROSS JOIN (VALUES ('PKR'), ('AED'), ('USD')) AS c(cur);

-- Biller catalog (stable ids so clients and seeds can refer to them).
INSERT INTO "billers" ("id","code","name","short_name","category","currency","country","reference_label","reference_pattern","supports_inquiry","allows_partial_payment","fee_fixed","active") VALUES
  ('b1110000-0000-4000-8000-000000000001','LESCO','Lahore Electric Supply Company','LESCO','ELECTRICITY','PKR','PK','Reference number','^\d{14}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000002','KE','K-Electric','K-Electric','ELECTRICITY','PKR','PK','Account number','^\d{13}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000003','IESCO','Islamabad Electric Supply Company','IESCO','ELECTRICITY','PKR','PK','Reference number','^\d{14}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000004','SNGPL','Sui Northern Gas Pipelines','SNGPL','GAS','PKR','PK','Consumer ID','^\d{11}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000005','SSGC','Sui Southern Gas Company','SSGC','GAS','PKR','PK','Consumer number','^\d{11}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000006','WASA_LHR','Water & Sanitation Agency Lahore','WASA','WATER','PKR','PK','Consumer number','^\d{10}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000007','PTCL','PTCL Broadband & Landline','PTCL','INTERNET','PKR','PK','Account ID','^\d{8,10}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000008','STORMFIBER','StormFiber','StormFiber','INTERNET','PKR','PK','Customer ID','^\d{6,10}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000009','NAYATEL','Nayatel','Nayatel','INTERNET','PKR','PK','Customer ID','^\d{6,8}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000010','JAZZ','Jazz Postpaid','Jazz','MOBILE','PKR','PK','Mobile number','^03\d{9}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000011','ZONG','Zong Postpaid','Zong','MOBILE','PKR','PK','Mobile number','^03\d{9}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000012','UFONE','Ufone Postpaid','Ufone','MOBILE','PKR','PK','Mobile number','^03\d{9}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000013','BEACONHOUSE','Beaconhouse School System','Beaconhouse','EDUCATION','PKR','PK','Challan number','^\d{8,12}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000014','FBR_PSID','FBR Tax Payment (PSID)','FBR','GOVERNMENT','PKR','PK','PSID','^\d{15,18}$',true,false,0,true),
  ('b1110000-0000-4000-8000-000000000015','DEWA','Dubai Electricity & Water Authority','DEWA','ELECTRICITY','AED','AE','Contract account number','^\d{10}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000016','SEWA','Sharjah Electricity, Water & Gas Authority','SEWA','ELECTRICITY','AED','AE','Account number','^\d{10}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000017','ETISALAT','e& (Etisalat) Postpaid','e&','MOBILE','AED','AE','Mobile number','^05\d{8}$',true,true,0,true),
  ('b1110000-0000-4000-8000-000000000018','DU','du Postpaid','du','MOBILE','AED','AE','Mobile number','^05\d{8}$',true,true,0,true);

-- Fraud engine policy: score >= 70 => CHALLENGE (OTP step-up), >= 90 => BLOCK (case opened).
-- Every rule alone stays below the challenge threshold, so ordinary demo usage is ALLOW;
-- only combinations of signals (or a rule re-weighted by an operator) challenge or block.
INSERT INTO "fraud_policies" ("id","challenge_threshold","block_threshold","updated_at") VALUES ('default', 70, 90, now());

INSERT INTO "fraud_rules" ("code","name","description","enabled","weight","severity","params","updated_at") VALUES
  ('VELOCITY', 'Outgoing velocity',
   'Many outgoing payments (P2P, QR, bills, card authorizations) in a short rolling window',
   true, 40, 'HIGH', '{"windowMinutes": 10, "maxCount": 50}', now()),
  ('AMOUNT_ANOMALY', 'Amount anomaly',
   'Amount far above the customer''s recent average outgoing payment',
   true, 35, 'MEDIUM', '{"multiplier": 10, "minHistory": 5, "lookback": 20, "minAmount": {"PKR": "2500000", "AED": "100000", "USD": "30000"}}', now()),
  ('NEW_DEVICE', 'New device, high value',
   'High-value payment from a device first seen recently, when the customer has an older device',
   true, 40, 'HIGH', '{"deviceAgeMinutes": 1440, "minAmount": {"PKR": "5000000", "AED": "200000", "USD": "50000"}}', now()),
  ('GEO_MISMATCH', 'Geo / IP mismatch',
   'Request country (edge geo-IP header) or card merchant country differs from the customer''s home country',
   true, 30, 'MEDIUM', '{"header": "x-geo-country"}', now()),
  ('FAILED_PINS', 'Repeated failed PINs',
   'Several wrong PIN attempts shortly before the payment',
   true, 30, 'MEDIUM', '{"windowMinutes": 60, "minFailures": 2}', now()),
  ('STRUCTURING', 'Structuring',
   'Several payments just below a reporting threshold within a day',
   true, 50, 'HIGH', '{"windowHours": 24, "bandPct": 10, "minCount": 3, "thresholds": {"PKR": "5000000", "AED": "300000", "USD": "100000"}}', now()),
  ('MULE_PATTERN', 'Mule pattern',
   'Money received from many distinct senders and quickly passed on',
   true, 60, 'CRITICAL', '{"windowHours": 24, "minSenders": 5, "passThroughPct": 80}', now());

-- MOCK sanctions list. Fictional names only; a real deployment calls a screening provider.
INSERT INTO "sanctions_entries" ("id","list_name","name","normalized_name","country") VALUES
  (gen_random_uuid(), 'MOCK-SDN', 'Viktor Blacklistov',          'viktor blacklistov',          'XX'),
  (gen_random_uuid(), 'MOCK-SDN', 'Shadow Ledger Trading LLC',   'shadow ledger trading llc',   'XX'),
  (gen_random_uuid(), 'MOCK-UN',  'Darkwater Holdings FZE',      'darkwater holdings fze',      'XX'),
  (gen_random_uuid(), 'MOCK-UN',  'Ahmad Embargoed Testname',    'ahmad embargoed testname',    'XX'),
  (gen_random_uuid(), 'MOCK-EU',  'Natalia Frozenasset',         'natalia frozenasset',         'XX');
