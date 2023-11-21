from subprocess import call

for file in [
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/8_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/8_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/8_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/8_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/8_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/14_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/14_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/14_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/14_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/14_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/19_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/19_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/19_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/19_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/19_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/20_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/20_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/20_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/20_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/20_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/23_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/23_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/23_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/23_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/23_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/32_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/32_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/32_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/32_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/32_sds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/36_dds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/36_input.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/36_pds.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/36_prompts.svg', 
'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/36_sds.svg'
]:
    id, rem = file.split('/')[-1].split('_')
    method, ext = rem.split('.')
    
    call(['mv', file, f'/home/chanhopark/63days.github.io/publications/posterior-distillation-sampling/static/data/svgs/{method}/{id}.{ext}'])