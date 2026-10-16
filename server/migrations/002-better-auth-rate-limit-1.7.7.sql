-- Generated using installed better-auth@1.7.7 getMigrations. Additive only.
create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
