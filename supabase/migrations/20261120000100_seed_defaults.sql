-- Default group, settings and destinations. Idempotent; runs on `supabase db push` too,
-- because production needs these rows. Destination coordinates are approximate fallbacks;
-- the app re-geocodes them on first enrichment and users can drag the pins in Settings.

insert into public.groups (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Belfield Hunt')
on conflict (id) do nothing;

insert into public.settings (group_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (group_id) do nothing;

insert into public.destinations (id, group_id, name, short_name, emoji, address, lat, lng, weight, is_intern_site, sort_order)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
   'UCD Belfield', 'UCD', '🎓', 'University College Dublin, Belfield, Dublin 4',
   53.3075, -6.2236, 1, false, 0),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001',
   'Sandyford Central Park', 'Sandyford', '💼', 'Central Park, Leopardstown, Dublin 18',
   53.2705, -6.2040, 1, true, 1)
on conflict (id) do nothing;
