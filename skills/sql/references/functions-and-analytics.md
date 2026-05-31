# Functions and Analytics

All functions grounded in `tests/UT/query_planner/cases/select/functions/`,
`tests/UT/query_planner/cases/select/aggregate/`,
`tests/UT/query_planner/cases/select/window/`,
`tests/UT/query_planner/cases/select/groupby/`, and
`src/schema/predefined_functions.cpp` (the function registry; `predefined_functions.h` is the 21-line interface declaration and does not list function names).

---

## Aggregate Functions

### Standard aggregates

```sql
SELECT
    COUNT(*)           AS total_rows,
    COUNT(amount)      AS non_null_count,
    SUM(amount)        AS total,
    AVG(amount)        AS average,
    MIN(amount)        AS minimum,
    MAX(amount)        AS maximum
FROM orders;

-- From test case: predefined_groupby_i32_null_column
SELECT i0,
       SUM(i2 + i1) AS s,
       COUNT(i0)    AS c,
       AVG(i1)      AS a
FROM tb1
GROUP BY i0;

-- From test case: predefined_sum_optimization
SELECT SUM(i0 + 10) FROM tb1;

-- From test case: predefined_avg_of_group_by_integer_not_null
SELECT AVG(agg), grp FROM tb1 GROUP BY grp;
```

### DISTINCT in aggregates

```sql
-- COUNT DISTINCT (from ClickBench test)
SELECT COUNT(DISTINCT UserID) FROM hits;
```

### Ordered-set aggregates

These aggregates require the `WITHIN GROUP (ORDER BY ...)` clause.

```sql
-- percentile_disc: discrete percentile (exact value from the data)
SELECT percentile_disc(0.3) WITHIN GROUP (ORDER BY i0 DESC)
FROM tb;

SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY amount DESC)
FROM orders;

-- percentile_disc with ARRAY of percentiles
SELECT percentile_disc(ARRAY[0.3, 0.9]) WITHIN GROUP (ORDER BY i0 DESC)
FROM tb;

-- percentile_cont: continuous/interpolated percentile
SELECT percentile_cont(0.3) WITHIN GROUP (ORDER BY i1)
FROM tb;

-- percentile_cont with array of percentiles
SELECT percentile_cont(ARRAY[0.3, 0.9]) WITHIN GROUP (ORDER BY i1)
FROM tb;

-- mode: most frequent value
SELECT mode() WITHIN GROUP (ORDER BY i0)
FROM tb
GROUP BY i1;
```

### Boolean aggregates

```sql
SELECT BOOL_OR(b0)  OVER () FROM tb1;   -- true if any value is true
SELECT BOOL_AND(b0) OVER () FROM tb1;   -- true if all values are true
```

### Correlation

```sql
-- CORR: Pearson correlation coefficient
SELECT CORR(i0, i1) FROM tb1;  -- both nullable
```

### FOR_MIN / FOR_MAX (Oxla-specific)

Returns the value of one column corresponding to the min/max of another:

```sql
-- From test case: predefined_groupby_no_column_formin_formax
SELECT FOR_MIN(i0, f0), FOR_MIN(i0, f1),
       FOR_MAX(i1, f0), FOR_MAX(i1, f1)
FROM tb1;

-- With GROUP BY
SELECT i0,
       FOR_MIN(i0, i0),
       FOR_MAX(f0, l0)
FROM tb1
GROUP BY i0;
```

---

## Window Functions

Window functions compute results over a sliding frame of rows. Use
`OVER (window_definition)` or a named window via `WINDOW w AS (...)`.

### Syntax

```sql
function_name([args]) OVER (
    [PARTITION BY col1, col2, ...]
    [ORDER BY col ASC|DESC]
    [frame_clause]
)
```

Frame clause forms:
- `ROWS BETWEEN n PRECEDING AND m FOLLOWING`
- `RANGE BETWEEN n PRECEDING AND m FOLLOWING`
- `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`
- `RANGE CURRENT ROW`
- `ROWS CURRENT ROW`

### Ranking functions

```sql
-- From test cases
SELECT RANK()        OVER (ORDER BY i0)           FROM tb1;
SELECT DENSE_RANK()  OVER (ORDER BY i0)           FROM tb1;
SELECT ROW_NUMBER()  OVER (PARTITION BY i2 ORDER BY i3) FROM tb1;
SELECT CUME_DIST()   OVER (ORDER BY i0 ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM tb1;
SELECT CUME_DIST()   OVER (ORDER BY i0 RANGE CURRENT ROW) FROM tb1;

-- NTILE
SELECT ntile(5) OVER ()                                        FROM tbl;
SELECT ntile(i0) OVER (ORDER BY i1)                           FROM tbl;
SELECT ntile(i1) OVER (ORDER BY i1 ROWS CURRENT ROW)          FROM tbl;
SELECT ntile(5) OVER (RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM tbl;
```

### Aggregate over window

```sql
-- SUM / AVG / COUNT over window
SELECT SUM(amount) OVER (PARTITION BY region ORDER BY order_date
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
FROM orders;

-- From test cases
SELECT AVG(i1) OVER (PARTITION BY i0
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM tb1;

SELECT AVG(i1) OVER (ORDER BY i0
                     RANGE BETWEEN CURRENT ROW AND 5 FOLLOWING) FROM tb1;

SELECT COUNT(b0) OVER (ORDER BY i0
                       RANGE BETWEEN 2 PRECEDING AND UNBOUNDED FOLLOWING) FROM tb1;

SELECT MIN(i0) OVER w, MAX(i1) OVER w
FROM tb1
WINDOW w AS (ORDER BY i0 RANGE BETWEEN 2 PRECEDING AND 3 FOLLOWING);

SELECT MIN(i0) OVER w, MAX(i1) OVER w
FROM tb1
WINDOW w AS (ROWS BETWEEN 2 PRECEDING AND 3 FOLLOWING);
```

### LAG / LEAD

```sql
-- LAG: access previous rows
SELECT LAG(i3)          OVER (PARTITION BY i2 ORDER BY i3) FROM tb1;  -- fixed offset 1
SELECT LAG(i3, i1)      OVER (PARTITION BY i2 ORDER BY i3) FROM tb1;  -- variable offset
SELECT LAG(i3, 1, i0)   OVER (PARTITION BY i2 ORDER BY i3) FROM tb1;  -- fixed offset, default
SELECT LAG(i3, i1, i0)  OVER (PARTITION BY i2 ORDER BY i3) FROM tb1;  -- variable offset, default

-- Practical example
SELECT order_date, amount,
       LAG(amount, 1)        OVER (ORDER BY order_date) AS prev_amount,
       amount - LAG(amount, 1) OVER (ORDER BY order_date) AS delta
FROM orders;
```

### FIRST_VALUE / LAST_VALUE / NTH_VALUE

```sql
-- From test case: predefined_first_nth_last_value
SELECT FIRST_VALUE(i3) OVER (),
       NTH_VALUE(i3, 2) OVER (ROWS BETWEEN 3 PRECEDING AND 1 FOLLOWING),
       LAST_VALUE(i3) OVER (PARTITION BY i2 ORDER BY i3)
FROM tb1;
```

### BOOL_OR / BOOL_AND over window

```sql
-- From test cases
SELECT BOOL_OR(b0) OVER ()               FROM tb1;
SELECT BOOL_AND(b0) OVER ()              FROM tb1;
SELECT BOOL_OR(b0) OVER (PARTITION BY i0),
       BOOL_AND(b0) OVER (PARTITION BY i1 ORDER BY i1) FROM tb1;
SELECT BOOL_OR(b0) OVER w, BOOL_AND(b0) OVER w
FROM tb1
WINDOW w AS (ORDER BY i0);
```

### SUM over INTERVAL

```sql
-- From test cases
SELECT SUM(iv1) OVER () FROM interval_tb;
SELECT SUM(iv0) OVER () FROM interval_tb;
```

### Named windows

```sql
-- Define a window once, use multiple times
SELECT SUM(i0) OVER w1, SUM(i1) OVER w1, ROW_NUMBER() OVER w1
FROM tb1
WINDOW w1 AS (PARTITION BY i2 ORDER BY i3);

-- Complex expressions in window definition
SELECT SUM(i0 - 10) OVER (
    PARTITION BY i0 + i1, i1
    ORDER BY i2, ABS(i3)
    ROWS BETWEEN 3 + 2 FOLLOWING AND 2 + 20 FOLLOWING
) FROM tb1;

-- Chained window functions
SELECT SUM(s.a) OVER ()
FROM (SELECT SUM(i0) OVER () AS a FROM tb1) AS s;

-- Same function over different windows
SELECT SUM(i0) OVER (ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING),
       SUM(i0) OVER (ROWS BETWEEN 30 PRECEDING AND 30 FOLLOWING)
FROM tb1;

-- Window with INTERVAL frame
SELECT COUNT(*) OVER (
    ORDER BY iv0
    RANGE BETWEEN INTERVAL '7 DAY' PRECEDING AND INTERVAL '1 DAY' PRECEDING
) FROM interval_tb;
```

### ROW_NUMBER in subquery

```sql
-- From test case: predefined_many_functions_over_syntactically_the_same_window
SELECT ROW_NUMBER() OVER w, subselect.row_plus_1
FROM (
    SELECT i0, (ROW_NUMBER() OVER w + 1) AS row_plus_1
    FROM tb1
    WINDOW w AS (PARTITION BY i0)
) AS subselect
WINDOW w AS (PARTITION BY subselect.i0);
```

---

## String Functions

| Function | Example | Notes |
|----------|---------|-------|
| `UPPER(s)` | `UPPER('hello')` → `'HELLO'` | Uppercase |
| `LOWER(s)` | `LOWER('HELLO')` → `'hello'` | Lowercase |
| `LENGTH(s)` | `LENGTH('abc')` → `3` | Character count |
| `CONCAT(s1, s2, ...)` | `CONCAT('a','b','c')` → `'abc'` | Multi-argument concat |
| `SUBSTR(s, start[, len])` | `SUBSTR('abc', 2)` → `'bc'` | 1-based start |
| `STARTS_WITH(s, prefix)` | `STARTS_WITH('abc', 'ab')` → `true` | Prefix test |
| `ENDS_WITH(s, suffix)` | `ENDS_WITH('abc', 'bc')` → `true` | Suffix test |
| `STRPOS(s, substr)` | `STRPOS('haystack', 'needle')` | Position of substr |
| `REPLACE(s, from, to)` | `REPLACE('abc', 'a', 'A')` | String replacement |
| `REGEXP_MATCH(s, pattern)` | `REGEXP_MATCH(s0, s1)` | Returns match array |
| `REGEXP_REPLACE(s, ptn, rep, flags)` | `REGEXP_REPLACE('abc','a.*','A','i')` | Regex replacement |

```sql
-- From test cases
SELECT UPPER(s0), LOWER(s0) FROM tb1;
SELECT LENGTH(s0) FROM tb1;
SELECT LENGTH(NULL);
SELECT LENGTH('example const string');
SELECT CONCAT(s0, 'abc', s1, 'def', 'ghi') FROM tb1;
SELECT CONCAT(s1, i1, 15.4, 'abc') FROM tb1;   -- mixed types
SELECT concat(i0, i1) FROM tb1;

SELECT SUBSTR(s0, i0) FROM tb1;
SELECT SUBSTR('abc', 2) FROM tb1;
SELECT SUBSTR(s0, 3) FROM tb1;
SELECT SUBSTR(s0, i0, i1) FROM tb1;              -- with length
SELECT SUBSTR('abc', 2, 3) FROM tb1;

SELECT STARTS_WITH(s0, s1) FROM tb1;
SELECT STARTS_WITH(s0, 'abc') FROM tb1;
SELECT STARTS_WITH('abc', s0) FROM tb1;

SELECT ENDS_WITH(s0, s1) FROM tb1;
SELECT ENDS_WITH(s0, 'abc') FROM tb1;

SELECT STRPOS(s0, s1) FROM tb1;
SELECT STRPOS(s0, 'abc') FROM tb1;
SELECT STRPOS('haystack', 'needle') FROM tb1;

SELECT REPLACE(s0, 'old_str', 'new_str') FROM orders;

SELECT regexp_match(s0, s1) FROM tb1;
SELECT regexp_replace(s0, s1, s2, 'i') FROM tb1;
SELECT regexp_replace('abc', 'a.*', 'A', 'i');
```

---

## Math Functions

| Function | Example |
|----------|---------|
| `ABS(x)` | `ABS(-5)` → `5` |
| `CEIL(x)` / `CEILING(x)` | `CEIL(1.2)` → `2` |
| `FLOOR(x)` | `FLOOR(1.9)` → `1` |
| `ROUND(x)` | `ROUND(1.567)` → `2` |
| `SIGN(x)` | `SIGN(-5)` → `-1` |
| `SQRT(x)` | `SQRT(16.0)` → `4.0` |
| `EXP(x)` | `EXP(1.0)` → `2.718...` |
| `LN(x)` | `LN(2.718)` → `~1.0` |
| `LOG10(x)` | `LOG10(100)` → `2.0` |
| `PI()` | `PI()` → `3.14159...` |
| `SIN(x)` | `SIN(0.0)` → `0.0` |
| `COS(x)` | `COS(0.0)` → `1.0` |
| `TAN(x)` | `TAN(0.785)` → `~1.0` |
| `TAND(x)` | degrees-based tangent |
| `COT(x)` | `COT(x)` |
| `COTD(x)` | degrees-based cotangent |
| `ATAN2(y, x)` | `ATAN2(1, 1)` |
| `DEGREES(x)` | radians to degrees |
| `RADIANS(x)` | degrees to radians |
| `RANDOM()` | random float in [0, 1) |

```sql
-- From test cases
SELECT ABS(i1), i0 FROM tb1;
SELECT CEIL(i1), CEIL(f1), CEIL(l0), CEIL(d0) FROM tb1;
SELECT FLOOR(i1), FLOOR(f1), FLOOR(l0), FLOOR(d0) FROM tb1;
SELECT ROUND(f0), ROUND(f1), ROUND(f2), ROUND(f3),
       ROUND(i0), ROUND(i1), ROUND(i2), ROUND(i3) FROM tb1;
SELECT SIGN(-1), SIGN(0), SIGN(1), SIGN(-1.0), SIGN(0.0), SIGN(1.0) FROM tb1;
SELECT SQRT(f1), SQRT(d0) FROM tb1;
SELECT EXP(f0), EXP(i0) FROM tb1;
SELECT LN(i1), LN(l0), LN(f1), LN(d0) FROM tb1;
SELECT LOG10(i1), LOG10(f1) FROM tb1;
SELECT f0 + PI() FROM tb1;
SELECT SIN(i1), SIN(f1), SIN(l0), SIN(d0) FROM tb1;
SELECT COS(i1), COS(f1), COS(l0), COS(d0) FROM tb1;
SELECT TAN(i1), TAN(f0), TAN(f1) FROM tb1;
SELECT TAND(i1), TAND(f0) FROM tb1;
SELECT COT(f0), COT(i0) FROM tb1;
SELECT COTD(f0), COTD(i0) FROM tb1;
SELECT ATAN2(i1, l0), ATAN2(f1, d0) FROM tb1;
SELECT DEGREES(i1), DEGREES(l0), DEGREES(f1), DEGREES(d0), DEGREES(123) FROM tb1;
SELECT RADIANS(i1), RADIANS(l0), RADIANS(f1), RADIANS(d0), RADIANS(123) FROM tb1;
SELECT random(), random();
```

---

## Date and Time Functions

### EXTRACT

```sql
-- From test cases
SELECT EXTRACT(year        FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(month       FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(day         FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(hour        FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(minute      FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(second      FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(milliseconds FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(microseconds FROM TIMESTAMP '2022-1-3 14:17:34') FROM tb1;
SELECT EXTRACT(YEAR FROM DATE '2001-02-16');
SELECT EXTRACT(YEAR FROM date0) FROM tb1;
```

### TIMESTAMP_TRUNC

Truncates a timestamp to a specified precision unit.

```sql
-- Supported units: year, month, day, hour, minute, second
SELECT TIMESTAMP_TRUNC(t0, year)    FROM tb1;
SELECT TIMESTAMP_TRUNC(t0, month)   FROM tb1;
SELECT TIMESTAMP_TRUNC(t0, day)     FROM tb1;
SELECT TIMESTAMP_TRUNC(t0, hour)    FROM tb1;
SELECT TIMESTAMP_TRUNC(t0, minute)  FROM tb1;
SELECT TIMESTAMP_TRUNC(t0, second)  FROM tb1;

-- Use in GROUP BY
SELECT TIMESTAMP_TRUNC(t0, HOUR) AS hr, COUNT(*)
FROM tb1
GROUP BY TIMESTAMP_TRUNC(t0, HOUR);
```

### MAKE_DATE / MAKE_TIME / MAKE_TIMESTAMP / MAKE_TIMESTAMPTZ

```sql
-- From test cases
SELECT MAKE_DATE(i0, i1, 20) FROM tb1;
SELECT MAKE_DATE(2024, 3, 15);

SELECT MAKE_TIME(i0, i1, 0.5) FROM tb1;

SELECT MAKE_TIMESTAMP(yr, 4, 2, hr, 37, 33.5) FROM tb1;
SELECT make_timestamp(1, 2, 3, NULL, 5, 6.6);

SELECT MAKE_TIMESTAMPTZ(yr, 4, 2, hr, 37, 33.5, 'Europe/London') FROM tb1;
SELECT make_timestamptz(1, 2, 3, 4, 5, 6.6, NULL);
```

### MAKE_INTERVAL

```sql
-- From test cases
SELECT MAKE_INTERVAL(25, 4, 0, 24, 11, 27, 9.78);        -- (years,months,weeks,days,hours,mins,secs)
SELECT MAKE_INTERVAL(25, NULL, NULL, 24, 11, 27, 9.78);   -- with NULLs
SELECT MAKE_INTERVAL(i1, i2, i3, i4, i5, i6, f1) FROM tb1;
```

### DATE() conversion

```sql
-- From test cases
SELECT DATE(s0) AS ds0, DATE(ts0) AS dts0, DATE(ts1) AS dts1 FROM tb1;
SELECT DATE('1970-01-01');
```

### CURRENT_TIMESTAMP

```sql
-- From test cases
SELECT CURRENT_TIMESTAMP FROM tb1;
SELECT CURRENT_TIMESTAMP(3) FROM tb1;  -- precision argument

-- Unix epoch conversions
SELECT UNIX_MICROS(CURRENT_TIMESTAMP) FROM tb1;
SELECT UNIX_MILLIS(CURRENT_TIMESTAMP) FROM tb1;
SELECT UNIX_SECONDS(CURRENT_TIMESTAMP) FROM tb1;
```

### Unix epoch conversions

```sql
-- From test cases
SELECT TIMESTAMP_MICROS(unix_micros(TIMESTAMP '2022-1-3 14:17:34.123456')) FROM tb1;
SELECT TIMESTAMP_MILLIS(unix_millis(TIMESTAMP '2022-1-3 14:17:34.123456')) FROM tb1;
SELECT TIMESTAMP_SECONDS(unix_seconds(TIMESTAMP '2022-1-3 14:17:34.123456')) FROM tb1;
```

### INTERVAL literals

```sql
-- From test cases
SELECT INTERVAL '13 month';
SELECT INTERVAL '73 day';
SELECT '1 day 1 month'::INTERVAL;
SELECT '533 minute'::INTERVAL;
SELECT '1234 second'::INTERVAL;
```

### Interval arithmetic

```sql
-- Add intervals (from insert_into test cases)
SELECT i0, iv0, iv1, iv2 FROM tb;        -- columns of INTERVAL type
INSERT INTO tb SELECT i0, iv0, iv1, iv2 FROM tb;

-- Timestamp - timestamp = interval
SELECT t1 - t0 FROM tb1;
```

---

## Array Functions

```sql
-- Append/prepend
SELECT ARRAY_APPEND(ai0, i0) FROM tb1;
SELECT ARRAY_PREPEND(0, ids) FROM tb1;

-- Array upper bound (length)
SELECT ARRAY_UPPER(a0, 1) FROM tb1;  -- dimension 1

-- Array indexing (1-based)
SELECT (ARRAY[1, 2, 3])[2];
SELECT (ARRAY[1, 2, 3])[i0] FROM tb1;

-- Array slice
SELECT (ARRAY[1, 2, 3])[0:2];

-- Array literal in SELECT
SELECT ARRAY[1, 2, 3];

-- PG_TYPEOF
SELECT PG_TYPEOF(a0) FROM tb1;
```

---

## Geospatial Functions

```sql
-- From test cases
SELECT ST_ASEWKT(CAST(point0 AS GEOMETRY)) FROM tbl;
SELECT ST_DISTANCE(geography0, GEOGRAPHY 'POINT(60.1699 24.9384)') FROM tbl;
SELECT ST_DISTANCE(geography0, geography1) FROM tbl;
```

---

## Analytical Query Patterns

### Star-schema aggregation

```sql
-- Revenue by nation, year (SSB Q3)
SELECT C_NATION   AS customer_nation,
       S_NATION   AS supplier_nation,
       EXTRACT(YEAR FROM LO_ORDERDATE) AS yr,
       SUM(LO_REVENUE) AS revenue
FROM (
    SELECT LO_ORDERDATE, LO_CUSTKEY, LO_SUPPKEY, LO_REVENUE
    FROM lineorder
    WHERE LO_ORDERDATE >= DATE '1992-01-01'
      AND LO_ORDERDATE <  DATE '1998-01-01'
) AS lineorder
JOIN (SELECT C_CUSTKEY, C_NATION FROM customer WHERE C_REGION = 'ASIA') AS customer
  ON LO_CUSTKEY = C_CUSTKEY
JOIN (SELECT S_SUPPKEY, S_NATION FROM supplier WHERE S_REGION = 'ASIA') AS supplier
  ON LO_SUPPKEY = S_SUPPKEY
GROUP BY C_NATION, S_NATION, EXTRACT(YEAR FROM LO_ORDERDATE)
ORDER BY EXTRACT(YEAR FROM LO_ORDERDATE) ASC, SUM(LO_REVENUE);
```

### ClickBench-style aggregations

```sql
-- From predefined_clickbench_q10 test
SELECT RegionID,
       SUM(AdvEngineID),
       COUNT(*) AS c,
       AVG(ResolutionWidth),
       COUNT(DISTINCT UserID)
FROM hits
GROUP BY RegionID
ORDER BY c DESC
LIMIT 4;

-- From predefined_clickbench_q17 test
SELECT UserID, SearchPhrase, COUNT(*)
FROM hits
GROUP BY UserID, SearchPhrase
ORDER BY COUNT(*) DESC
LIMIT 10;
```

### Time-series bucketing

```sql
-- Monthly revenue trend
WITH monthly AS (
    SELECT TIMESTAMP_TRUNC(order_date::TIMESTAMP, MONTH) AS month_start,
           SUM(amount) AS revenue
    FROM orders
    GROUP BY TIMESTAMP_TRUNC(order_date::TIMESTAMP, MONTH)
)
SELECT month_start,
       revenue,
       SUM(revenue) OVER (ORDER BY month_start
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       AVG(revenue) OVER (ORDER BY month_start ROWS 2 PRECEDING)             AS three_month_avg
FROM monthly
ORDER BY month_start;
```

### Percentile analysis

```sql
-- Revenue percentiles
SELECT
    percentile_disc(0.5)  WITHIN GROUP (ORDER BY amount) AS p50,
    percentile_disc(0.90) WITHIN GROUP (ORDER BY amount) AS p90,
    percentile_disc(0.99) WITHIN GROUP (ORDER BY amount) AS p99,
    percentile_cont(ARRAY[0.25, 0.50, 0.75]) WITHIN GROUP (ORDER BY amount) AS quartiles
FROM orders;
```

### Ranking and top-N per group

```sql
-- Top 3 orders per region
SELECT order_id, region, amount, rnk
FROM (
    SELECT order_id, region, amount,
           RANK() OVER (PARTITION BY region ORDER BY amount DESC) AS rnk
    FROM orders
) sub
WHERE rnk <= 3
ORDER BY region, rnk;
```

### GENERATE_SERIES for date scaffolding

```sql
-- Generate a date spine
SELECT gs::DATE AS day
FROM generate_series(0, 30) AS gs;
```

---

## Function Quick Reference

| Category | Functions |
|----------|-----------|
| Aggregates | `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `CORR`, `BOOL_OR`, `BOOL_AND`, `FOR_MIN`, `FOR_MAX` |
| Ordered-set | `percentile_disc`, `percentile_cont`, `mode` |
| Window ranking | `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`, `CUME_DIST` |
| Window offset | `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE` |
| String | `UPPER`, `LOWER`, `LENGTH`, `CONCAT`, `SUBSTR`, `STARTS_WITH`, `ENDS_WITH`, `STRPOS`, `REPLACE`, `REGEXP_MATCH`, `REGEXP_REPLACE` |
| Math | `ABS`, `CEIL`, `FLOOR`, `ROUND`, `SIGN`, `SQRT`, `EXP`, `LN`, `LOG10`, `PI`, `SIN`, `COS`, `TAN`, `TAND`, `COT`, `COTD`, `ATAN2`, `DEGREES`, `RADIANS`, `RANDOM` |
| Date/time | `EXTRACT`, `TIMESTAMP_TRUNC`, `MAKE_DATE`, `MAKE_TIME`, `MAKE_TIMESTAMP`, `MAKE_TIMESTAMPTZ`, `MAKE_INTERVAL`, `DATE`, `CURRENT_TIMESTAMP`, `UNIX_MICROS`, `UNIX_MILLIS`, `UNIX_SECONDS`, `TIMESTAMP_MICROS`, `TIMESTAMP_MILLIS`, `TIMESTAMP_SECONDS` |
| Array | `ARRAY_APPEND`, `ARRAY_PREPEND`, `ARRAY_UPPER`, `PG_TYPEOF` |
| Geospatial | `ST_ASEWKT`, `ST_DISTANCE` |
| Control flow | `CASE WHEN`, `IF(cond, true_val, false_val)` |
| Table-valued | `generate_series(start, stop[, step])` |
