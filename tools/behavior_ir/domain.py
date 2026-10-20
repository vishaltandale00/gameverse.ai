"""Exact-width entry domains; signed ranges use two's-complement storage."""
def checked(d,bits):
 if not d:return
 if 'signed_min'in d or'signed_max'in d:
  if set(d)!={'signed_min','signed_max'}or not-(1<<(bits-1))<=d['signed_min']<=d['signed_max']<1<<(bits-1):raise ValueError('invalid signed entry domain')
 elif set(d)-{'unsigned_min','unsigned_max'}or not 0<=d.get('unsigned_min',0)<=d.get('unsigned_max',(1<<bits)-1)<1<<bits:raise ValueError('invalid unsigned entry domain')
def accepts(d,value,bits):
 checked(d,bits);value&=(1<<bits)-1
 if 'signed_min'in d:
  signed=value-(1<<bits)if value>>(bits-1)else value;return d['signed_min']<=signed<=d['signed_max']
 return d.get('unsigned_min',0)<=value<=d.get('unsigned_max',(1<<bits)-1)
def native_interval(d,bits):
 checked(d,bits)
 if 'signed_min'in d:
  lo,hi=d['signed_min'],d['signed_max']
  if bits==32 and hi-lo+1==1<<32:return 0,0xffffffff
  return lo&0xffffffff,hi&0xffffffff
 return d.get('unsigned_min',0),d.get('unsigned_max',0xffffffff)
