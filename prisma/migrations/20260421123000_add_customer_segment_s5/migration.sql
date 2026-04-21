ALTER TABLE `Customer`
    MODIFY `segment` ENUM('S1', 'S2', 'S3', 'S4', 'S5') NOT NULL DEFAULT 'S1';

ALTER TABLE `CouponRedemption`
    MODIFY `segmentAtRedeem` ENUM('S1', 'S2', 'S3', 'S4', 'S5') NULL;
