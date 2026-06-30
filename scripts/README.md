# Scripts

This directory is reserved for ETL and maintenance scripts.

The first production ETL script should fetch one public indicator, normalize it into the `Country`, `Indicator`, `Series`, and `Observation` shape, and then write through the backend data layer or Prisma client.
