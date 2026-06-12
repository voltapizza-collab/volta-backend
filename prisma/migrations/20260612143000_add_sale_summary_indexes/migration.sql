CREATE INDEX `Sale_partnerId_status_processed_date_idx`
  ON `Sale` (`partnerId`, `status`, `processed`, `date`);

CREATE INDEX `Sale_storeId_status_processed_date_idx`
  ON `Sale` (`storeId`, `status`, `processed`, `date`);
