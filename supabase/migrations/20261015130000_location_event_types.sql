-- TRZ-96: enum values must be committed before they are used.
alter type public.event_type add value if not exists 'location_assigned';
alter type public.event_type add value if not exists 'location_changed';
