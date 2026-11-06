-- Local development seed (`supabase db reset`). Production reference data lives in
-- migrations/20261023000900_reference_data.sql; courses come from the admin import.

insert into public.batches (year) values (2023), (2024), (2025), (2026) on conflict do nothing;
