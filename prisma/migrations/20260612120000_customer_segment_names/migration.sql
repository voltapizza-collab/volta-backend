ALTER TABLE `Customer`
    MODIFY `segment` VARCHAR(32) NOT NULL DEFAULT 'potencial';

UPDATE `Customer`
SET `segment` = CASE `segment`
    WHEN 'S1' THEN 'potencial'
    WHEN 'S2' THEN 'nuevo'
    WHEN 'S3' THEN 'dormido'
    WHEN 'S4' THEN 'activo'
    WHEN 'S5' THEN 'vip'
    ELSE LOWER(`segment`)
END;

ALTER TABLE `Customer`
    MODIFY `segment` ENUM('potencial', 'nuevo', 'dormido', 'activo', 'vip') NOT NULL DEFAULT 'potencial';

ALTER TABLE `CouponRedemption`
    MODIFY `segmentAtRedeem` VARCHAR(32) NULL;

UPDATE `CouponRedemption`
SET `segmentAtRedeem` = CASE `segmentAtRedeem`
    WHEN 'S1' THEN 'potencial'
    WHEN 'S2' THEN 'nuevo'
    WHEN 'S3' THEN 'dormido'
    WHEN 'S4' THEN 'activo'
    WHEN 'S5' THEN 'vip'
    ELSE LOWER(`segmentAtRedeem`)
END
WHERE `segmentAtRedeem` IS NOT NULL;

ALTER TABLE `CouponRedemption`
    MODIFY `segmentAtRedeem` ENUM('potencial', 'nuevo', 'dormido', 'activo', 'vip') NULL;

UPDATE `Coupon`
SET `segments` = JSON_REPLACE(`segments`, JSON_UNQUOTE(JSON_SEARCH(`segments`, 'one', 'S1')), 'potencial')
WHERE JSON_SEARCH(`segments`, 'one', 'S1') IS NOT NULL;

UPDATE `Coupon`
SET `segments` = JSON_REPLACE(`segments`, JSON_UNQUOTE(JSON_SEARCH(`segments`, 'one', 'S2')), 'nuevo')
WHERE JSON_SEARCH(`segments`, 'one', 'S2') IS NOT NULL;

UPDATE `Coupon`
SET `segments` = JSON_REPLACE(`segments`, JSON_UNQUOTE(JSON_SEARCH(`segments`, 'one', 'S3')), 'dormido')
WHERE JSON_SEARCH(`segments`, 'one', 'S3') IS NOT NULL;

UPDATE `Coupon`
SET `segments` = JSON_REPLACE(`segments`, JSON_UNQUOTE(JSON_SEARCH(`segments`, 'one', 'S4')), 'activo')
WHERE JSON_SEARCH(`segments`, 'one', 'S4') IS NOT NULL;

UPDATE `Coupon`
SET `segments` = JSON_REPLACE(`segments`, JSON_UNQUOTE(JSON_SEARCH(`segments`, 'one', 'S5')), 'vip')
WHERE JSON_SEARCH(`segments`, 'one', 'S5') IS NOT NULL;

UPDATE `Coupon`
SET `meta` = JSON_SET(
    `meta`,
    '$.targetCustomerSegment',
    CASE JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.targetCustomerSegment'))
        WHEN 'S1' THEN 'potencial'
        WHEN 'S2' THEN 'nuevo'
        WHEN 'S3' THEN 'dormido'
        WHEN 'S4' THEN 'activo'
        WHEN 'S5' THEN 'vip'
        ELSE LOWER(JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.targetCustomerSegment')))
    END
)
WHERE JSON_EXTRACT(`meta`, '$.targetCustomerSegment') IS NOT NULL;

UPDATE `Sale`
SET `customerData` = JSON_SET(
    `customerData`,
    '$.segment',
    CASE JSON_UNQUOTE(JSON_EXTRACT(`customerData`, '$.segment'))
        WHEN 'S1' THEN 'potencial'
        WHEN 'S2' THEN 'nuevo'
        WHEN 'S3' THEN 'dormido'
        WHEN 'S4' THEN 'activo'
        WHEN 'S5' THEN 'vip'
        ELSE LOWER(JSON_UNQUOTE(JSON_EXTRACT(`customerData`, '$.segment')))
    END
)
WHERE JSON_EXTRACT(`customerData`, '$.segment') IS NOT NULL;
