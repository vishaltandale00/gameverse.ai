ENTRY(_start)
MEMORY { ROM (rx) : ORIGIN = 0x08000000, LENGTH = 32M
RAM (rw) : ORIGIN = 0x02000000, LENGTH = 256K }
SECTIONS {
 .text : { KEEP(*(.header)) KEEP(*(.text.startup)) *(.text*) *(.rodata*) } > ROM
 .data : { *(.data*) } > RAM AT> ROM
 .bss (NOLOAD) : { . = ALIGN(4); __bss_start = .; *(.bss*) *(COMMON) . = ALIGN(4); __bss_end = .; } > RAM
 /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) }
}
ASSERT(SIZEOF(.data)==0,"Runtime requires explicit initialized-data copy before supporting .data")
