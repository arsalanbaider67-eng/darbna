-- New report kinds: checkpoints, speed cameras, fuel station status.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_category_check;
ALTER TABLE reports ADD CONSTRAINT reports_category_check CHECK (category IN (
  'congestion','crash','closure','roadworks','pothole','flooding',
  'checkpoint','checkpoint_slow','camera','fuel_queue','fuel_closed'));
