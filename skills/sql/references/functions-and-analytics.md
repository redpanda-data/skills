Source: cloud-docs `modules/reference/pages/sql/sql-functions/**`, `modules/reference/pages/sql/sql-clauses/over-window.adoc`, `modules/reference/pages/sql/sql-data-types/{geometry,geography,uuid}.adoc` (verified 2026-10-18). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Functions and Analytics

Only the functions below are published for Redpanda SQL. If a PostgreSQL function
is not listed, do not assume it exists; check the
[SQL functions reference](https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-functions/)
or test it with a `SELECT` before relying on it.

Examples read from `default_redpanda_catalog=>orders` (columns `order_id`,
`customer`, `product`, `amount`, `quantity`, `status`, `created_at`); substitute the user's
mapped tables.

---

## Aggregate functions

| Function | Notes |
|---|---|
| `count(*)`, `count(expr)` | rows, or non-null values |
| `sum(expr)`, `avg(expr)` | not on `numeric` yet; cast to `double precision` |
| `min(expr)`, `max(expr)` | same type as input; `NaN` if the input contains `NaN` |
| `bool_and(expr)`, `bool_or(expr)` | all true / any true |
| `for_min(metric, value)`, `for_max(metric, value)` | `value` from the row with the smallest / largest `metric` |
| `DISTINCT` qualifier | aggregate over distinct values, for example `count(DISTINCT customer)` |

Use them with `GROUP BY` and `HAVING`:

```sql
SELECT customer,
       COUNT(*)                AS orders,
       COUNT(DISTINCT product) AS products,
       SUM(amount)             AS revenue,
       BOOL_OR(status = 'pending') AS has_pending
FROM default_redpanda_catalog=>orders
GROUP BY customer
HAVING SUM(amount) > 10000;
```

### FOR_MIN / FOR_MAX

```sql
-- The ID of each customer's largest order, and the ID of their first order
SELECT customer,
       FOR_MAX(amount, order_id)       AS biggest_order_id,
       FOR_MIN(created_at, order_id)   AS first_order_id
FROM default_redpanda_catalog=>orders
GROUP BY customer;
```

- `metric` must be `int`, `long` (`bigint`), `float`, `double`, `date`, or
  `timestamp`. `value` can be any type except `text`.
- Returns `NULL` when there are no rows, when `metric` is all `NULL`, or when the
  `value` at the extreme is `NULL`; returns `NaN` if the input contains `NaN`.

### Ordered-set aggregates

```sql
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)                    AS median,
       PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY amount)                    AS p90,
       PERCENTILE_CONT(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY amount) AS quartiles,
       MODE() WITHIN GROUP (ORDER BY product)                                 AS most_common_product
FROM default_redpanda_catalog=>orders;
```

- `percentile_cont` interpolates; `percentile_disc` returns an actual value (the
  first one in the ordering when several share the rank).
- Pass an array of fractions to get an array of results in the same shape.
- `mode()` ignores nulls; if `NULL` is the most frequent value it returns the next
  most common one.

### Statistical aggregates

| Function | Result |
|---|---|
| `corr(y, x)` | Pearson correlation |
| `covar_pop(y, x)`, `covar_samp(y, x)` | population / sample covariance |
| `regr_slope(y, x)`, `regr_intercept(y, x)`, `regr_r2(y, x)` | least-squares line and R² |
| `regr_count(y, x)` | rows where both are non-null |
| `regr_avgx(y, x)`, `regr_avgy(y, x)` | averages of x and y |
| `regr_sxx(y, x)`, `regr_syy(y, x)`, `regr_sxy(y, x)` | sums of squares and products |
| `stddev(x)` / `stddev_samp(x)`, `stddev_pop(x)` | sample / population standard deviation |
| `variance(x)` / `var_samp(x)`, `var_pop(x)` | sample / population variance |

```sql
SELECT CORR(amount, quantity), REGR_SLOPE(amount, quantity), STDDEV_POP(amount)
FROM default_redpanda_catalog=>orders;
```

---

## Window functions

```sql
function_name([args]) OVER (
    [PARTITION BY expr [, ...]]
    [ORDER BY expr [ASC | DESC] [NULLS FIRST | NULLS LAST] [, ...]]
    [frame_clause]
)
```

| Group | Functions |
|---|---|
| Aggregate | `count`, `sum`, `avg`, `min`, `max`, `bool_and`, `bool_or` |
| Ranking | `row_number()`, `rank()`, `dense_rank()`, `ntile(buckets)` |
| Distribution | `cume_dist()`, `percent_rank()` |
| Value | `first_value(expr)`, `last_value(expr)`, `nth_value(expr, n)`, `lag(expr[, offset[, default]])`, `lead(expr[, offset[, default]])` |

**Frames.** `ROWS` and `RANGE` are supported; `GROUPS` and frame exclusion are
not.

```sql
{ ROWS | RANGE } frame_start
{ ROWS | RANGE } BETWEEN frame_start AND frame_end
-- frame_start / frame_end: UNBOUNDED PRECEDING | n PRECEDING | CURRENT ROW | n FOLLOWING | UNBOUNDED FOLLOWING
```

`frame_end` defaults to `CURRENT ROW`; `frame_start` cannot be `UNBOUNDED
FOLLOWING`, `frame_end` cannot be `UNBOUNDED PRECEDING`, and the end cannot come
before the start. `ROWS` frames can give unpredictable results when `ORDER BY`
does not order rows uniquely.

**Named windows.** `WINDOW w AS (...)` defines a window once. A definition can
build on an earlier one (`w2 AS (w1 ROWS CURRENT ROW)`) as long as the earlier one
has no frame clause; it inherits `PARTITION BY` and `ORDER BY`, cannot add its own
`PARTITION BY`, and can add `ORDER BY` only if the base has none. An empty
definition is a window over all rows.

```sql
-- Rank, running total, previous value, and share of the customer's total
SELECT order_id, customer, amount,
       RANK()       OVER by_amount                                   AS rnk,
       SUM(amount)  OVER (PARTITION BY customer ORDER BY created_at
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       LAG(amount, 1, 0) OVER (PARTITION BY customer ORDER BY created_at)   AS prev_amount,
       amount * 1.0 / SUM(amount) OVER (PARTITION BY customer)       AS share
FROM default_redpanda_catalog=>orders
WINDOW by_amount AS (PARTITION BY customer ORDER BY amount DESC);

-- Top 3 orders per customer
SELECT * FROM (
    SELECT order_id, customer, amount,
           ROW_NUMBER() OVER (PARTITION BY customer ORDER BY amount DESC) AS rn
    FROM default_redpanda_catalog=>orders
) AS ranked
WHERE rn <= 3;

-- Moving average over the current and two previous rows
SELECT created_at, amount,
       AVG(amount) OVER (ORDER BY created_at ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS moving_avg
FROM default_redpanda_catalog=>orders;
```

---

## String functions

| Function | Notes |
|---|---|
| `length(s)` | characters (bytes for `bytea`) |
| `octet_length(data)` | bytes |
| `lower(s)`, `upper(s)` | case |
| `concat(v1, v2, ...)` | any types except `timestamp with time zone`; skips `NULL` |
| `substring(s, start[, len])` / `substr` | 1-based; negative `len` is an error |
| `strpos(s, sub)`, `position(sub IN s)` | position of the first match |
| `starts_with(s, prefix)`, `ends_with(s, suffix)` | boolean |
| `replace(s, from, to)` | all occurrences |
| `trim(s[, chars])`, `TRIM([LEADING \| TRAILING \| BOTH] [chars] FROM s)` | default removes spaces from both ends |
| `ltrim(s[, chars])`, `rtrim(s[, chars])`, `btrim(s[, chars])` | one end / the other / both |
| `regexp_match(s, pattern[, flags])` | POSIX regex match |
| `regexp_replace(s, pattern, replacement[, flags])` | flags: `g` all matches, `i` case-insensitive, `c` case-sensitive (default) |
| `encode(data, format)`, `decode(text, format)` | `bytea` ↔ text: `hex`, `base64`, `escape` |

```sql
SELECT UPPER(customer),
       SUBSTRING(product, 1, 3),
       POSITION('board' IN product),
       TRIM(BOTH ' ' FROM customer),
       REGEXP_REPLACE(product, '^key', 'KEY', 'gi'),
       customer || ' / ' || product
FROM default_redpanda_catalog=>orders;

SELECT ENCODE((redpanda).key, 'hex') FROM default_redpanda_catalog=>orders;   -- raw key bytes as hex
```

Pattern operators (`LIKE`/`~~`, `~~*` for ILIKE, `~`, `~*`, `!~`, `!~*`) are in
[statements.md](statements.md#operators).

---

## Math functions

| Function | Notes |
|---|---|
| `abs(x)` | `ABS(-1.0)` returns `1`, not `1.0` |
| `ceil(x)` / `ceiling(x)`, `floor(x)` | |
| `round(x)`, `round(x, scale)` | |
| `sign(x)` | -1, 0, or 1 |
| `sqrt(x)`, `cbrt(x)` | `SQRT(-1)` is an out-of-range error |
| `exp(x)`, `power(a, b)` | |
| `ln(x)`, `log10(x)`, `log(x)`, `log(base, x)` | `LN(0)` → Infinity, `LOG10(-1)` → NaN (PostgreSQL raises errors) |
| `gamma(x)` | |
| `greatest(v, ...)`, `least(v, ...)` | |
| `pi()`, `random()` | `random()` is in [0, 1) |
| `to_char(number, format)` | patterns `9`, `0`, `.`, `,`, `D`, `G`, `S`, `PL`, `MI`, `SG` |

Trigonometric (radians, or degrees for the `-d` forms), taking `real` or `double
precision`: `sin`, `cos`, `tan`, `cot`, `asin`, `acos`, `atan`, `atan2(y, x)`,
`sind`, `cosd`, `tand`, `cotd`, `asind`, `acosd`, `atand`, `atan2d(y, x)`,
`degrees(x)`, `radians(x)`. Hyperbolic: `sinh`, `cosh`, `tanh`.

`SET oxla.enable_fast_math = ON` trades precision for speed in math functions.

---

## Timestamp and date functions

| Function | Notes |
|---|---|
| `current_timestamp`, `current_timestamp(precision)` | precision 0–6 fractional digits; default 6 |
| `now()` | same as `current_timestamp` |
| `extract(field FROM source)` | `timestamp`/`timestamptz`: `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND` (returns `double precision`; `SECOND` includes the fraction). `date`: `YEAR`, `MONTH`, `DAY` (returns `integer`) |
| `timestamp_trunc(ts, unit)` | unit: `SECOND`, `MINUTE`, `HOUR`, `DAY`, `MONTH`, `YEAR` |
| `date_trunc(field, source[, time_zone])` | `source`: `timestamp`, `timestamp with time zone`, or `interval`; field: `microseconds`, `milliseconds` (intervals only), `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`, `decade`, `century`, `millennium` |
| `to_char(ts, format)` | patterns `YYYY`, `MM`, `DD`, `HH`/`HH12`, `HH24`, `MI`, `SS`, `MS`, `US`, `AM`/`PM`, `A.M.`/`P.M.` |
| `to_timestamp(text, format)` | returns `timestamp with time zone`; `NULL` input returns `NULL` |
| `format_timestamp(text, format)` | parses text in the given format; returns a timestamp with time zone |
| `unix_seconds(ts)`, `unix_millis(ts)`, `unix_micros(ts)` | timestamp → epoch `bigint` |
| `timestamp_seconds(n)`, `timestamp_millis(n)`, `timestamp_micros(n)` | epoch `bigint` → timestamp |
| `make_date(y, m, d)`, `make_time(h, m, s)` | |
| `make_timestamp(y, mo, d, h, mi, s)`, `make_timestamptz(y, mo, d, h, mi, s[, tz])` | |
| `make_interval([years[, months[, weeks[, days[, hours[, mins[, secs]]]]]]])` | |

```sql
-- Hourly event counts for the last day
SELECT TIMESTAMP_TRUNC(created_at, HOUR) AS hr, COUNT(*) AS events
FROM default_redpanda_catalog=>orders
WHERE created_at >= NOW() - INTERVAL '1 day'
GROUP BY TIMESTAMP_TRUNC(created_at, HOUR)
ORDER BY hr;

-- Weekly buckets and formatted output
SELECT DATE_TRUNC('week', created_at) AS week, TO_CHAR(MIN(created_at), 'YYYY-MM-DD HH24:MI') AS first_seen
FROM default_redpanda_catalog=>orders
GROUP BY DATE_TRUNC('week', created_at);

-- Epoch conversions
SELECT UNIX_MILLIS(created_at), TIMESTAMP_SECONDS(1671975000)
FROM default_redpanda_catalog=>orders LIMIT 1;
```

Date/time arithmetic operators and `AT TIME ZONE` are in
[connect-and-types.md](connect-and-types.md#date-time-timestamp-interval).

---

## JSON functions

| Function | Result |
|---|---|
| `json_extract_path(json, path...)` | sub-object as `json` (same as `->`) |
| `json_extract_path_text(json, path...)` | value as `text` (same as `->>`) |
| `json_array_length(json)` | number of elements in the outer array |
| `json_array_extract(json, index)` | element of a JSON array, index from 0 |

```sql
SELECT payload ->> 'customer'                         AS customer,
       payload -> 'items'                             AS items,
       JSON_ARRAY_LENGTH(payload -> 'items')          AS item_count,
       JSON_EXTRACT_PATH_TEXT(payload, 'status')      AS status
FROM default_redpanda_catalog=>orders_json;
```

---

## Conditional and null-handling functions

```sql
SELECT IF(amount > 10000, 'large', 'small')                  AS size,      -- IF(condition, then, else)
       CASE WHEN status = 'pending' THEN 1 ELSE 0 END        AS is_pending,
       COALESCE(status, 'unknown')                           AS status,    -- first non-null
       NULLIF(status, '')                                    AS status_or_null
FROM default_redpanda_catalog=>orders;
```

`IS [NOT] DISTINCT FROM` compares with `NULL` treated as a value.

---

## Other functions

| Function | Returns |
|---|---|
| `gen_random_uuid()`, `uuidv4()` | random version-4 `uuid` |
| `generate_series(start, stop[, step])` | table function of `bigint` values in `FROM`; inclusive; empty when the step points away from `stop` |
| `pg_typeof(any)` | type name of a value (for example `map(text,integer)`) |
| `current_database()`, `current_schema()`, `version()` | session and engine information |
| `has_schema_privilege([user,] schema, privilege)` | `create` or `usage` check |
| `has_database_privilege([user,] database, privilege)` | for example `connect` |
| `pg_backend_pid()` | process ID of the server process handling the session |
| `pg_size_pretty(bytes)`, `pg_table_size(rel)`, `pg_total_relation_size(rel)` | sizes |
| `pg_get_userbyid(oid)`, `pg_table_is_visible(oid)`, `pg_get_expr(...)`, `pg_get_indexdef(oid)`, `pg_get_constraintdef(oid)`, `pg_get_statisticsobjdef_columns(oid)`, `pg_encoding_to_char(n)`, `pg_relation_is_publishable(rel)` | PostgreSQL catalog helpers for tools |
| `obj_description(oid, catalog)`, `col_description(...)`, `shobj_description(oid, catalog)` | object comments |

Geospatial: `st_astext`, `st_asewkt`, `st_distance` on `geometry` and `geography`
points; see [connect-and-types.md](connect-and-types.md#geometry-and-geography).

```sql
-- A gap-free spine to join sparse data against
SELECT * FROM GENERATE_SERIES(0, 23);

SELECT pg_typeof(amount), pg_typeof(created_at) FROM default_redpanda_catalog=>orders LIMIT 1;
```

---

## Analytical patterns

```sql
-- Orders and revenue by status
SELECT status, COUNT(*) AS orders, SUM(amount) AS revenue
FROM default_redpanda_catalog=>orders
GROUP BY status
ORDER BY orders DESC;

-- Day-over-day change
WITH daily AS (
    SELECT TIMESTAMP_TRUNC(created_at, DAY) AS day, SUM(amount) AS revenue
    FROM default_redpanda_catalog=>orders
    GROUP BY TIMESTAMP_TRUNC(created_at, DAY)
)
SELECT day, revenue,
       revenue - LAG(revenue) OVER (ORDER BY day) AS change
FROM daily
ORDER BY day;

-- Percentiles per product
SELECT product,
       PERCENTILE_CONT(ARRAY[0.5, 0.9, 0.99]) WITHIN GROUP (ORDER BY amount) AS p50_p90_p99
FROM default_redpanda_catalog=>orders
GROUP BY product;
```
